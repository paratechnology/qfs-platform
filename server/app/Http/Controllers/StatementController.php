<?php

namespace App\Http\Controllers;

use App\Support\Api;
use App\Support\CryptoAssets;
use App\Support\CryptoFunds;
use App\Support\Guard;
use App\Support\Reconciliation;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class StatementController
{
    public function show(Request $request): Response
    {
        $user = Guard::user($request);
        $data = $request->validate(['from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d', 'format' => 'nullable|in:json,csv,print']);
        $to = CarbonImmutable::parse($data['to'] ?? now('UTC')->format('Y-m-d'), 'UTC')->startOfDay();
        $from = CarbonImmutable::parse($data['from'] ?? $to->startOfMonth()->format('Y-m-d'), 'UTC')->startOfDay();
        if ($from->greaterThan($to) || $from->diffInDays($to) > 365 || $to->greaterThan(CarbonImmutable::now('UTC')->startOfDay())) {
            Guard::fail('BAD_REQUEST', 'Choose a valid statement period of up to one year, ending today or earlier.', 400);
        }
        $format = $data['format'] ?? 'json';
        $statement = DB::transaction(function () use ($user, $from, $to, $format) {
            $account = DB::table('Account')->where('userId', $user->id)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            $query = DB::table('Transaction')->where('userId', $user->id)->where('createdAt', '>=', $from)->where('createdAt', '<', $to->addDay());
            $count = (clone $query)->count();
            if ($format !== 'json' && $count > 50000) {
                Guard::fail('BAD_REQUEST', 'This statement is too large. Choose a shorter period.', 400);
            }
            $transactions = $query->orderBy('createdAt')->orderBy('id')->limit($format === 'json' ? 500 : 50000)->get()->map(function ($row) use ($account) {
                $asset = $row->assetKey ? CryptoAssets::get($row->assetKey) : null;
                $deduction = $row->type === 'ADJUSTMENT' && DB::table('LedgerEntry')->where('accountId', $account->id)->where('txId', $row->id)->value('movement') === 'DEBIT';

                return ['reference' => $row->reference, 'type' => $row->type, 'status' => $row->status,
                    'createdAt' => CarbonImmutable::parse($row->createdAt, 'UTC')->toIso8601String(),
                    'amountCents' => $deduction ? -$row->amountCents : $row->amountCents, 'feeCents' => $row->feeCents, 'currency' => $row->currency,
                    'assetKey' => $row->assetKey, 'quantity' => $asset ? CryptoAssets::quantity($row->assetKey, $row->quantityAtomic) : null,
                    'displayAmount' => ($deduction ? '-' : '').CryptoFunds::transactionAmount($row), 'note' => $row->note];
            })->all();
            $investments = DB::table('Investment')->where('userId', $user->id)->orderByDesc('startDate')->get()
                ->map(fn ($row) => ['id' => $row->id, 'status' => $row->status, 'amountCents' => $row->amountCents,
                    'monthlyRoiBps' => $row->monthlyRoiBps, 'termMonths' => $row->termMonths,
                    'payoutInterval' => $row->payoutInterval, 'paidOutCents' => $row->paidOutCents,
                    'startDate' => $row->startDate, 'endDate' => $row->endDate])->all();
            $holdings = DB::table('CryptoBalance')->where('userId', $user->id)->orderBy('assetKey')->get()
                ->map(fn ($row) => ['assetKey' => $row->assetKey, 'quantity' => CryptoAssets::quantity($row->assetKey, $row->totalAtomic),
                    'reserved' => CryptoAssets::quantity($row->assetKey, $row->reservedAtomic)])->all();

            return ['from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d'), 'timezone' => 'UTC',
                'generatedAt' => now('UTC')->toIso8601String(), 'name' => $user->name, 'email' => $user->email,
                'balanceCents' => $account->balanceCents, 'availableCents' => $account->availableCents,
                'holdings' => $holdings, 'investments' => $investments, 'transactions' => $transactions,
                'transactionCount' => $count, 'previewLimited' => $format === 'json' && $count > 500];
        });
        if ($format === 'print') {
            return response()->view('statements.account', ['statement' => $statement])
                ->header('Cache-Control', 'private, no-store')->header('X-Content-Type-Options', 'nosniff');
        }
        if ($format !== 'csv') {
            return Api::ok($statement);
        }

        return response()->streamDownload(function () use ($statement) {
            $output = fopen('php://output', 'w');
            $write = function (array $cells) use ($output): void {
                fputcsv($output, array_map(fn ($cell) => preg_match('/^[\s]*[=+@\-\t\r]/u', (string) $cell) ? "'".$cell : $cell, $cells), ',', '"', '');
            };
            $write(['Record', 'Recorded at (UTC)', 'Reference', 'Type', 'Status', 'Currency', 'USD amount', 'USD fee', 'Asset/network', 'Crypto quantity / reserved', 'Details']);
            $write(['PERIOD', $statement['generatedAt'], '', '', '', '', '', '', '', '', $statement['from'].' to '.$statement['to'].'; activity timestamps are UTC. Snapshot rows show current values, not historical closing balances.']);
            $write(['CURRENT_USD_BALANCE', $statement['generatedAt'], '', '', '', 'USD', self::decimal($statement['balanceCents']), '', '', '', 'Available USD: '.self::decimal($statement['availableCents'])]);
            foreach ($statement['holdings'] as $holding) {
                $write(['CURRENT_CRYPTO_BALANCE', $statement['generatedAt'], '', '', '', '', '', '', $holding['assetKey'], $holding['quantity'], 'Reserved: '.$holding['reserved']]);
            }
            foreach ($statement['transactions'] as $row) {
                $write(['TRANSACTION', $row['createdAt'], $row['reference'], $row['type'], $row['status'], $row['currency'], self::decimal($row['amountCents']), self::decimal($row['feeCents']), $row['assetKey'], $row['quantity'], $row['displayAmount'].'; '.$row['note']]);
            }
            foreach ($statement['investments'] as $row) {
                $write(['CURRENT_INVESTMENT', $row['startDate'], $row['id'], 'INVESTMENT', $row['status'], 'USD', self::decimal($row['amountCents']), '', '', '',
                    'Monthly rate: '.number_format($row['monthlyRoiBps'] / 100, 2, '.', '').'%; term: '.$row['termMonths'].' months; payout: '.$row['payoutInterval'].'; ends: '.$row['endDate'].'; paid profit USD: '.self::decimal($row['paidOutCents'])]);
            }
            fclose($output);
        }, 'qfs-statement-'.$statement['from'].'-'.$statement['to'].'.csv', ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    private static function decimal(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    public function reconcile(Request $request): JsonResponse
    {
        Guard::admin($request);
        $data = $request->validate(['after' => 'nullable|string|max:64']);
        $accounts = DB::table('Account')->when(isset($data['after']), fn ($q) => $q->where('id', '>', $data['after']))->orderBy('id')->limit(26)->get();
        $items = $accounts->take(25)->map(fn ($account) => Reconciliation::account($account->userId))->all();

        return Api::ok(['items' => $items, 'checkedAt' => now('UTC')->toIso8601String(), 'nextCursor' => $accounts->count() > 25 ? $accounts[24]->id : null]);
    }
}
