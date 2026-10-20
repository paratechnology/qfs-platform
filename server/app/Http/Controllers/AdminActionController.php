<?php

namespace App\Http\Controllers;

use App\Support\AdminLog;
use App\Support\Api;
use App\Support\CryptoFunds;
use App\Support\Guard;
use App\Support\Qfs;
use App\Support\ReferralRewards;
use App\Support\TwoFactor;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;

final class AdminActionController
{
    private function valid(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }

        return $validator->validated();
    }

    public function user(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $this->valid($request, [
            'action' => 'required|in:SUSPEND,ACTIVATE,SET_ROLE,UPDATE_PROFILE', 'role' => 'required_if:action,SET_ROLE|in:USER,ADMIN',
        ]);
        $target = DB::table('User')->where('id', $id)->first();
        if (! $target) {
            Guard::fail('NOT_FOUND', 'User not found', 404);
        }
        if ($id === $admin->id && $data['action'] !== 'ACTIVATE') {
            Guard::fail('BAD_REQUEST', 'You cannot change your own account from here', 400);
        }
        if ($data['action'] === 'UPDATE_PROFILE') {
            return $this->updateProfile($request, $admin, $id);
        }
        DB::transaction(function () use ($admin, $data, $id) {
            $users = DB::table('User')->whereIn('id', [$admin->id, $id])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $actor = $users->get($admin->id);
            if (! $actor || $actor->role !== 'ADMIN' || $actor->status !== 'ACTIVE') {
                Guard::fail('FORBIDDEN', 'You do not have access to this action.', 403);
            }
            $target = $users->get($id);
            if (! $target) {
                Guard::fail('NOT_FOUND', 'User not found', 404);
            }
            $update = match ($data['action']) {
                'SUSPEND' => ['status' => 'SUSPENDED'],
                'ACTIVATE' => ['status' => 'ACTIVE'],
                'SET_ROLE' => ['role' => $data['role'] ?? 'USER'],
            };
            $update['updatedAt'] = Qfs::now();
            DB::table('User')->where('id', $id)->update($update);
            if ($data['action'] === 'SUSPEND' ||
                ($data['action'] === 'SET_ROLE' && $update['role'] !== $target->role)) {
                DB::table('Session')->where('userId', $id)->delete();
            }
            AdminLog::audit($admin->id, 'USER.'.$data['action'], 'User', $id, ['role' => $data['role'] ?? null]);
            [$title, $body] = match ($data['action']) {
                'SUSPEND' => ['Account suspended', 'Your account has been suspended. Contact support.'],
                'ACTIVATE' => ['Account activated', 'Your account is active again.'],
                'SET_ROLE' => ['Account updated', 'Your account role is now {role}.'],
            };
            AdminLog::notify($id, $title, $body, $data['action'] === 'SET_ROLE' ? ['role' => $data['role'] ?? 'USER'] : []);
        });
        $changed = DB::table('User')->where('id', $id)->first();

        return Api::ok(['id' => $id, 'status' => $changed->status, 'role' => $changed->role]);
    }

    private function updateProfile(Request $request, object $admin, string $id): JsonResponse
    {
        $request->merge(array_map(fn ($value) => is_string($value) ? trim($value) : $value,
            $request->only('name', 'email', 'phone', 'country', 'reason')));
        $data = $this->valid($request, [
            'name' => 'required|string|min:2|max:120', 'email' => 'required|email|max:200',
            'country' => 'required|string|min:2|max:80',
            'phone' => ['nullable', 'string', 'min:7', 'max:24', 'regex:/^[+()\-\s\d]+$/'],
            'reason' => 'required|string|min:3|max:300', 'currentPassword' => 'required|string|max:200',
            'code' => 'nullable|string|max:30',
        ]);
        $key = 'admin-profile:'.$admin->id;
        if (RateLimiter::tooManyAttempts($key, 10)) {
            Guard::fail('TOO_MANY_REQUESTS', 'Too many requests. Please try again later.', 429);
        }
        RateLimiter::hit($key, 60);
        try {
            $changed = DB::transaction(function () use ($request, $data, $admin, $id) {
                $users = DB::table('User')->whereIn('id', [$admin->id, $id])->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                $actor = $users->get($admin->id);
                if (! $actor || $actor->role !== 'ADMIN' || $actor->status !== 'ACTIVE' ||
                    ! DB::table('Session')->where('id', $request->attributes->get('qfs_session_id'))->where('expiresAt', '>', Qfs::now())->exists()) {
                    Guard::fail('FORBIDDEN', 'You do not have access to this action.', 403);
                }
                if (! Hash::check($data['currentPassword'], $actor->passwordHash)) {
                    Guard::fail('INVALID_PASSWORD', 'Your current password is incorrect.', 400);
                }
                $security = DB::table('AccountSecurity')->where('userId', $actor->id)->lockForUpdate()->first();
                if ($security?->enabledAt && ! TwoFactor::verify($security, $data['code'] ?? '')) {
                    Guard::fail('INVALID_CODE', 'Enter a new authenticator code or an unused recovery code.', 400);
                }
                $target = $users->get($id);
                if (! $target) {
                    Guard::fail('NOT_FOUND', 'User not found', 404);
                }
                $update = ['name' => $data['name'], 'email' => strtolower($data['email']),
                    'phone' => ($data['phone'] ?? null) ?: null, 'country' => $data['country']];
                if (DB::table('User')->where('email', $update['email'])->where('id', '!=', $id)->exists()) {
                    Guard::fail('CONFLICT', 'An account with this email already exists.', 409);
                }
                $fields = array_keys(array_filter($update, fn ($value, $field) => $value !== $target->$field, ARRAY_FILTER_USE_BOTH));
                if ($fields === []) {
                    return ['id' => $id, 'changed' => false, 'sessionsRevoked' => false];
                }
                DB::table('User')->where('id', $id)->update([...$update, 'updatedAt' => Qfs::now()]);
                $emailChanged = in_array('email', $fields, true);
                if ($emailChanged) {
                    DB::table('Session')->where('userId', $id)->delete();
                    DB::table('PasswordRecoveryToken')->where('userId', $id)->delete();
                    DB::table('LoginChallenge')->where('userId', $id)->delete();
                }
                AdminLog::audit($actor->id, 'USER.UPDATE_PROFILE', 'User', $id, ['fields' => $fields, 'reason' => $data['reason']]);
                AdminLog::notify($id, 'Account details updated', $emailChanged
                    ? 'An administrator updated your account details. Your email changed, so your devices were signed out. Contact support if you did not request this change.'
                    : 'An administrator updated your account details. Contact support if you did not request this change.');

                return ['id' => $id, 'changed' => true, 'sessionsRevoked' => $emailChanged];
            });
        } catch (UniqueConstraintViolationException) {
            Guard::fail('CONFLICT', 'An account with this email already exists.', 409);
        }

        return Api::ok($changed);
    }

    public function request(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $this->valid($request, ['action' => 'required|in:APPROVE,REJECT', 'note' => 'sometimes|nullable|string|max:300', 'txHash' => 'sometimes|nullable|string|max:100']);
        $type = $request->query('type') === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT';
        $table = $type === 'DEPOSIT' ? 'DepositRequest' : 'WithdrawalRequest';
        $status = $data['action'] === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        $alreadyReviewed = false;
        DB::transaction(function () use ($admin, $data, $type, $table, $id, $status, &$alreadyReviewed) {
            $ownerId = DB::table($table)->where('id', $id)->value('userId');
            if ($ownerId) {
                $referrerId = DB::table('User')->where('id', $ownerId)->value('referredById');
                DB::table('Account')->whereIn('userId', array_filter([$ownerId, $referrerId]))
                    ->orderBy('userId')->lockForUpdate()->get();
            }
            $item = DB::table($table)->where('id', $id)->lockForUpdate()->first();
            if (! $item) {
                Guard::fail('NOT_FOUND', ucfirst(strtolower($type)).' request not found', 404);
            }
            if ($item->status !== 'PENDING') {
                $sameHash = ! array_key_exists('txHash', $data) || trim($data['txHash'] ?? '') === ($item->txHash ?? '');
                $sameNote = ! array_key_exists('note', $data) || trim($data['note'] ?? '') === ($item->adminNote ?? '');
                if ($item->status === $status && $sameHash && $sameNote) {
                    $alreadyReviewed = true;

                    return;
                }
                Guard::fail('CONFLICT', 'This request was already reviewed', 409);
            }
            if (! empty($item->assetKey)) {
                CryptoFunds::review($admin, $item, $type, $status, trim($data['note'] ?? ''),
                    array_key_exists('txHash', $data) ? $data['txHash'] : $item->txHash);

                return;
            }
            $account = DB::table('Account')->where('userId', $item->userId)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            $now = Qfs::now();
            $note = trim($data['note'] ?? '');
            $txId = null;
            if ($status === 'APPROVED') {
                if ($type === 'WITHDRAWAL' && $account->balanceCents < $item->amountCents) {
                    Guard::fail('BAD_REQUEST', 'Insufficient account balance — cannot pay this withdrawal', 400);
                }
                if ($type === 'DEPOSIT' && ($account->balanceCents + $item->amountCents > 2147483647 ||
                    $account->availableCents + $item->amountCents > 2147483647)) {
                    Guard::fail('BAD_REQUEST', 'Account balance limit exceeded', 400);
                }
                $txId = Qfs::id();
                DB::table('Transaction')->insert([
                    'id' => $txId, 'userId' => $item->userId, 'type' => $type,
                    'amountCents' => $item->amountCents, 'method' => $item->method,
                    'reference' => ($type === 'DEPOSIT' ? 'TX-DEP-' : 'TX-WD-').$item->id,
                    'status' => 'COMPLETED', 'completedAt' => $now,
                    'note' => $note ?: ($type === 'DEPOSIT' ? 'Deposit approved' : 'Withdrawal paid'),
                    'meta' => $type === 'WITHDRAWAL' ? $item->details : null,
                ]);
            }
            $delta = $type === 'DEPOSIT' && $status === 'APPROVED' ? $item->amountCents
                : ($type === 'WITHDRAWAL' && $status === 'APPROVED' ? -$item->amountCents : 0);
            $availableDelta = $type === 'DEPOSIT' && $status === 'APPROVED' ? $item->amountCents
                : ($type === 'WITHDRAWAL' && $status === 'REJECTED' ? $item->amountCents : 0);
            if ($delta || $availableDelta) {
                DB::table('Account')->where('id', $account->id)->update([
                    'balanceCents' => $account->balanceCents + $delta,
                    'availableCents' => $account->availableCents + $availableDelta,
                    'updatedAt' => $now,
                ]);
                DB::table('LedgerEntry')->insert([
                    'id' => Qfs::id(), 'accountId' => $account->id,
                    'movement' => $delta < 0 || $availableDelta < 0 ? 'DEBIT' : 'CREDIT',
                    'amountCents' => $item->amountCents,
                    'balanceAfterCents' => $account->balanceCents + $delta,
                    'txId' => $txId,
                    'note' => $type === 'WITHDRAWAL' && $status === 'REJECTED'
                        ? 'Withdrawal reservation released ('.$item->reference.')'
                        : ucfirst(strtolower($type)).' via '.$item->method,
                ]);
            }
            DB::table($table)->where('id', $id)->update([
                'status' => $status, 'reviewedById' => $admin->id, 'reviewedAt' => $now,
                'adminNote' => $note ?: null, 'transactionId' => $txId,
            ]);
            if ($type === 'DEPOSIT' && $status === 'APPROVED') {
                ReferralRewards::approvedDeposit($item);
            }
            AdminLog::audit($admin->id, 'REQUEST.'.$data['action'].'_'.$type, $table, $id,
                ['amountCents' => $item->amountCents]);
            $title = ucfirst(strtolower($type)).' '.strtolower($status);
            $body = $status === 'APPROVED'
                ? ($type === 'DEPOSIT' ? 'Your deposit has been approved and credited to your account.'
                    : 'Your withdrawal has been approved and paid out.')
                : ($note ?: ($type === 'DEPOSIT' ? 'Your deposit request was rejected.'
                    : 'Your withdrawal request was rejected and funds returned to your balance.'));
            AdminLog::notify($item->userId, $title, $body);
        });

        return Api::ok(['decided' => true, 'status' => $status, 'alreadyReviewed' => $alreadyReviewed]);
    }

    public function loan(Request $request, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $this->valid($request, ['action' => 'required|in:APPROVE,REJECT', 'note' => 'sometimes|nullable|string|max:300']);
        $status = $data['action'] === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
        DB::transaction(function () use ($admin, $data, $id, $status) {
            $loan = DB::table('Loan')->where('id', $id)->lockForUpdate()->first();
            if (! $loan) {
                Guard::fail('NOT_FOUND', 'Loan not found', 404);
            }
            if ($loan->status !== 'PENDING') {
                Guard::fail('CONFLICT', 'This loan was already reviewed', 409);
            }
            DB::table('Loan')->where('id', $id)->update([
                'status' => $status, 'dueDate' => $status === 'ACTIVE' ? now()->addMonths(min(max($loan->period, 1), 120)) : null,
                'decidedById' => $admin->id, 'decidedAt' => Qfs::now(),
                'adminNote' => trim($data['note'] ?? '') ?: null,
            ]);
            AdminLog::audit($admin->id, 'LOAN.'.$data['action'], 'Loan', $id, ['amountCents' => $loan->amountCents]);
            AdminLog::notify($loan->userId, $status === 'ACTIVE' ? 'Loan approved' : 'Loan rejected',
                $status === 'ACTIVE' ? (trim($data['note'] ?? '') ?: 'Your {type} loan of {amount, number, ::currency/USD} has been approved. This approval has not credited your account.')
                    : (trim($data['note'] ?? '') ?: 'Your loan application was rejected.'),
                $status === 'ACTIVE' && ! trim($data['note'] ?? '') ? ['type' => $loan->type, 'amount' => $loan->amountCents / 100] : []);
        });

        return Api::ok(['decided' => true, 'status' => $status]);
    }

    private function adjustOne(string $actorId, string $userId, int $amountCents, string $note): array
    {
        return DB::transaction(function () use ($actorId, $userId, $amountCents, $note) {
            $target = DB::table('User')->where('id', $userId)->first();
            if (! $target) {
                Guard::fail('NOT_FOUND', 'User not found', 404);
            }
            if ($target->role !== 'USER') {
                Guard::fail('BAD_REQUEST', 'Adjustments target regular user accounts only', 400);
            }
            $account = DB::table('Account')->where('userId', $userId)->lockForUpdate()->first();
            if (! $account) {
                Guard::fail('NOT_FOUND', 'Account not found', 404);
            }
            $debit = $amountCents < 0;
            $abs = abs($amountCents);
            if ($debit && $account->availableCents < $abs) {
                Guard::fail('BAD_REQUEST', "Cannot deduct more than the user's available balance", 400);
            }
            $newBalance = $account->balanceCents + $amountCents;
            $newAvailable = $account->availableCents + $amountCents;
            if ($newBalance > 2147483647 || $newAvailable > 2147483647) {
                Guard::fail('BAD_REQUEST', 'Account balance limit exceeded', 400);
            }
            $txId = Qfs::id();
            DB::table('Transaction')->insert([
                'id' => $txId, 'userId' => $userId, 'type' => 'ADJUSTMENT',
                'amountCents' => $abs, 'method' => 'Manual', 'reference' => Qfs::reference('ADJ'),
                'status' => 'COMPLETED', 'completedAt' => Qfs::now(), 'note' => $note, 'adminNote' => $note,
            ]);
            DB::table('Account')->where('id', $account->id)->update([
                'balanceCents' => $newBalance, 'availableCents' => $newAvailable, 'updatedAt' => Qfs::now(),
            ]);
            DB::table('LedgerEntry')->insert([
                'id' => Qfs::id(), 'accountId' => $account->id,
                'movement' => $debit ? 'DEBIT' : 'CREDIT', 'amountCents' => $abs,
                'balanceAfterCents' => $newBalance, 'txId' => $txId,
                'note' => 'Manual '.($debit ? 'deduction' : 'credit').' — '.$note,
            ]);
            AdminLog::audit($actorId, 'FIN.ADJUST', 'User', $userId, ['amountCents' => $amountCents, 'note' => $note]);
            AdminLog::notify($userId, $debit ? 'Account adjustment' : 'Profit credited',
                $debit ? 'Deducted {amount, number, ::currency/USD} from your balance — {note}.' : 'Credited {amount, number, ::currency/USD} to your balance — {note}.',
                ['amount' => $abs / 100, 'note' => $note]);

            return ['applied' => true, 'debit' => $debit, 'abs' => $abs,
                'newBalance' => $newBalance, 'newAvailable' => $newAvailable];
        });
    }

    public function adjustment(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $this->valid($request, [
            'scope' => 'required|in:USER,ALL', 'userId' => 'sometimes|string|max:64',
            'direction' => 'required|in:CREDIT,DEBIT', 'amount' => 'required|numeric|gt:0|max:1000000',
            'note' => 'required|string|min:3|max:300',
        ]);
        $cents = Qfs::cents($data['amount']);
        if (! $cents) {
            Guard::fail('BAD_REQUEST', 'Amount can have at most 2 decimal places', 400);
        }
        $signed = $data['direction'] === 'DEBIT' ? -$cents : $cents;
        $note = trim($data['note']);
        if ($data['scope'] === 'USER') {
            if (empty($data['userId'])) {
                Guard::fail('BAD_REQUEST', 'Select a user for a single adjustment', 400);
            }
            $result = $this->adjustOne($admin->id, $data['userId'], $signed, $note);

            return Api::ok(['scope' => 'USER', 'applied' => $result['applied'],
                'direction' => $result['debit'] ? 'DEBIT' : 'CREDIT',
                'amountCents' => $result['abs'], 'balanceCents' => $result['newBalance'],
                'availableCents' => $result['newAvailable']]);
        }
        $ids = DB::table('User')->where('role', 'USER')->pluck('id');
        $applied = 0;
        foreach ($ids as $id) {
            try {
                $this->adjustOne($admin->id, $id, $signed, $note);
                $applied++;
            } catch (HttpResponseException $e) { /* underfunded users are skipped */
            }
        }
        AdminLog::audit($admin->id, 'FIN.ADJUST_ALL', 'User', null,
            ['amountCents' => $signed, 'note' => $note, 'total' => $ids->count(),
                'applied' => $applied, 'skipped' => $ids->count() - $applied]);

        return Api::ok(['scope' => 'ALL', 'total' => $ids->count(),
            'applied' => $applied, 'skipped' => $ids->count() - $applied]);
    }
}
