<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\CryptoFunds;
use App\Support\Guard;
use App\Support\LocalizedText;
use App\Support\PlanMaterials;
use App\Support\Qfs;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class MoneyController
{
    private function input(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $data = $validator->validated();
        $data['amountCents'] = Qfs::cents($data['amount']);
        if ($data['amountCents'] === null) {
            Guard::fail('BAD_REQUEST', 'Amount can have at most 2 decimal places', 400);
        }

        return $data;
    }

    private function moneyRules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'gt:0', 'max:1000000'],
            'reference' => ['sometimes', 'string', 'min:4', 'max:80'],
        ];
    }

    public function deposit(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        if ($request->input('method') !== 'Bank Transfer') {
            Guard::fail('CRYPTO_FUNDING', 'Use the crypto deposit flow to record the asset, network and quantity.', 400);
        }
        $data = $this->input($request, $this->moneyRules() + [
            'method' => ['required', 'string', 'min:2', 'max:40'],
            'walletAddress' => ['sometimes', 'regex:/^0x[0-9a-fA-F]{40}$/'],
        ]);
        $reference = trim($data['reference'] ?? '') ?: Qfs::reference('DEP');
        try {
            [$row, $created] = DB::transaction(function () use ($user, $data, $reference) {
                DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
                $existing = DB::table('DepositRequest')->where('reference', $reference)->first();
                if ($existing) {
                    if ($existing->userId !== $user->id) {
                        Guard::fail('CONFLICT', 'Reference already in use', 409);
                    }

                    return [$existing, false];
                }
                $id = Qfs::id();
                DB::table('DepositRequest')->insert([
                    'id' => $id, 'userId' => $user->id, 'amountCents' => $data['amountCents'],
                    'method' => trim($data['method']), 'reference' => $reference,
                    'walletAddress' => $data['walletAddress'] ?? null,
                ]);

                return [DB::table('DepositRequest')->where('id', $id)->first(), true];
            });
        } catch (QueryException $e) {
            $row = DB::table('DepositRequest')->where('reference', $reference)->first();
            if (! $row) {
                throw $e;
            }
            if ($row->userId !== $user->id) {
                Guard::fail('CONFLICT', 'Reference already in use', 409);
            }
            $created = false;
        }

        return Api::ok(['request' => $row, 'created' => $created, 'status' => $row->status]);
    }

    public function withdrawal(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        if ($request->input('method') !== 'Bank Transfer') {
            Guard::fail('CRYPTO_FUNDING', 'Use the crypto withdrawal flow to confirm the asset, network and quantity.', 400);
        }
        $data = $this->input($request, $this->moneyRules() + [
            'method' => ['required', 'string', 'min:2', 'max:40'],
            'details' => ['sometimes', 'string', 'min:3', 'max:500'],
            'walletAddress' => ['sometimes', 'regex:/^0x[0-9a-fA-F]{40}$/'],
        ]);
        $reference = trim($data['reference'] ?? '') ?: Qfs::reference('WD');
        try {
            $result = DB::transaction(function () use ($user, $data, $reference) {
                $account = DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
                if (! $account) {
                    Guard::fail('NOT_FOUND', 'Account not found', 404);
                }
                $existing = DB::table('WithdrawalRequest')->where('reference', $reference)->first();
                if ($existing) {
                    if ($existing->userId !== $user->id) {
                        Guard::fail('CONFLICT', 'Reference already in use', 409);
                    }

                    return [$existing, false];
                }
                $minimum = (int) (DB::table('Setting')->where('key', 'min_withdrawal_cents')->value('value') ?? 0);
                $maximum = (int) (DB::table('Setting')->where('key', 'max_withdrawal_daily_cents')->value('value') ?? 0);
                if ($minimum > 0 && $data['amountCents'] < $minimum) {
                    Guard::fail('BAD_REQUEST', LocalizedText::translate('Minimum withdrawal is {amount}', ['amount' => Qfs::money($minimum)]), 400);
                }
                if ($maximum > 0) {
                    $used = (int) DB::table('WithdrawalRequest')->where('userId', $user->id)
                        ->where('createdAt', '>=', now()->subDay())->where('status', '!=', 'REJECTED')->sum('amountCents');
                    if ($used + $data['amountCents'] > $maximum) {
                        Guard::fail('BAD_REQUEST', LocalizedText::translate('Daily withdrawal limit reached — {amount} max per 24 hours', ['amount' => Qfs::money($maximum)]), 400);
                    }
                }
                if ($account->availableCents < $data['amountCents']) {
                    Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available balance for this withdrawal', 400);
                }
                $id = Qfs::id();
                DB::table('WithdrawalRequest')->insert([
                    'id' => $id, 'userId' => $user->id, 'amountCents' => $data['amountCents'],
                    'method' => trim($data['method']), 'details' => $data['details'] ?? null,
                    'reference' => $reference, 'walletAddress' => $data['walletAddress'] ?? null,
                ]);
                DB::table('Account')->where('id', $account->id)->update([
                    'availableCents' => $account->availableCents - $data['amountCents'], 'updatedAt' => Qfs::now(),
                ]);
                DB::table('LedgerEntry')->insert([
                    'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'DEBIT',
                    'amountCents' => $data['amountCents'], 'balanceAfterCents' => $account->balanceCents,
                    'note' => 'Reserved for withdrawal ('.$reference.')',
                ]);

                return [DB::table('WithdrawalRequest')->where('id', $id)->first(), true];
            });
        } catch (QueryException $e) {
            $row = DB::table('WithdrawalRequest')->where('reference', $reference)->first();
            if (! $row) {
                throw $e;
            }
            if ($row->userId !== $user->id) {
                Guard::fail('CONFLICT', 'Reference already in use', 409);
            }
            $result = [$row, false];
        }

        return Api::ok(['request' => $result[0], 'created' => $result[1], 'status' => $result[0]->status]);
    }

    public function investment(Request $request): JsonResponse
    {
        $user = Guard::user($request);
        $data = $this->input($request, $this->moneyRules() + ['planId' => ['required', 'string', 'max:64'], 'quoteId' => 'sometimes|string|max:64']);
        $reference = trim($data['reference'] ?? '') ?: Qfs::reference('INV');
        try {
            $result = DB::transaction(function () use ($user, $data, $reference) {
                $ids = [$user->id];
                $accounts = DB::table('Account')->whereIn('userId', $ids)
                    ->orderBy('userId')->lockForUpdate()->get()->keyBy('userId');
                $account = $accounts->get($user->id);
                if (! $account) {
                    Guard::fail('NOT_FOUND', 'Account not found', 404);
                }
                $dup = DB::table('Transaction')->where('reference', $reference)->first();
                if ($dup) {
                    if ($dup->userId !== $user->id || $dup->type !== 'INVESTMENT') {
                        Guard::fail('CONFLICT', 'Reference already in use', 409);
                    }
                    $id = json_decode($dup->meta ?? '{}', true)['investmentId'] ?? null;

                    return [$id ? DB::table('Investment')->where('id', $id)->first() : null, false];
                }
                $plan = DB::table('InvestmentPlan')->where('id', $data['planId'])->first();
                if (! $plan) {
                    Guard::fail('NOT_FOUND', 'Investment plan not found', 404);
                }
                if (! $plan->isActive) {
                    Guard::fail('BAD_REQUEST', 'This plan is no longer available', 400);
                }
                if ($data['amountCents'] < $plan->minAmountCents) {
                    Guard::fail('BAD_REQUEST', LocalizedText::translate('Minimum investment for this plan is {amount}', ['amount' => Qfs::money($plan->minAmountCents)]), 400);
                }
                if ($plan->maxAmountCents && $data['amountCents'] > $plan->maxAmountCents) {
                    Guard::fail('BAD_REQUEST', LocalizedText::translate('Maximum investment for this plan is {amount}', ['amount' => Qfs::money($plan->maxAmountCents)]), 400);
                }
                $funding = isset($data['quoteId'])
                    ? CryptoFunds::fundInvestment($account, $data['quoteId'], $data['amountCents'], $reference) : null;
                if ($account->availableCents < $data['amountCents']) {
                    Guard::fail('INSUFFICIENT_FUNDS', 'Insufficient available balance for this investment', 400);
                }
                $now = Qfs::now();
                $investmentId = Qfs::id();
                $txId = Qfs::id();
                DB::table('Investment')->insert([
                    'id' => $investmentId, 'userId' => $user->id, 'planId' => $plan->id,
                    'amountCents' => $data['amountCents'], 'startDate' => $now,
                    'endDate' => now()->addMonthsNoOverflow($plan->termMonths),
                    'monthlyRoiBps' => $plan->monthlyRoiBps, 'termMonths' => $plan->termMonths,
                    'payoutInterval' => $plan->payoutInterval,
                    'principalRelease' => $plan->principalRelease,
                    'materials' => PlanMaterials::snapshot($plan),
                    ...($funding ? ['funding' => json_encode($funding)] : []),
                ]);
                DB::table('Transaction')->insert([
                    'id' => $txId, 'userId' => $user->id, 'type' => 'INVESTMENT',
                    'amountCents' => $data['amountCents'], 'method' => 'Main Balance',
                    'reference' => $reference, 'status' => 'COMPLETED', 'completedAt' => $now,
                    'note' => $plan->name.' · '.$plan->termMonths.' months',
                    'meta' => json_encode(['investmentId' => $investmentId, 'planId' => $plan->id]),
                ]);
                DB::table('Account')->where('id', $account->id)->update([
                    'availableCents' => $account->availableCents - $data['amountCents'], 'updatedAt' => $now,
                ]);
                DB::table('LedgerEntry')->insert([
                    'id' => Qfs::id(), 'accountId' => $account->id, 'movement' => 'DEBIT',
                    'amountCents' => $data['amountCents'], 'balanceAfterCents' => $account->balanceCents,
                    'txId' => $txId, 'note' => 'Invested in '.$plan->name,
                ]);
                AdminLog::notify($user->id, 'Investment started',
                    'Your {plan} investment of {amount, number, ::currency/USD} is now active.', ['plan' => $plan->name, 'amount' => $data['amountCents'] / 100]);

                return [DB::table('Investment')->where('id', $investmentId)->first(), true];
            });
        } catch (QueryException $e) {
            $tx = DB::table('Transaction')->where('reference', $reference)->first();
            if (! $tx) {
                throw $e;
            }
            if ($tx->userId !== $user->id || $tx->type !== 'INVESTMENT') {
                Guard::fail('CONFLICT', 'Reference already in use', 409);
            }
            $investmentId = json_decode($tx->meta ?? '{}', true)['investmentId'] ?? null;
            $result = [$investmentId ? DB::table('Investment')->where('id', $investmentId)->first() : null, false];
        }

        return Api::ok(['investment' => $result[0], 'created' => $result[1]]);
    }
}
