<?php

namespace App\Http\Controllers;

use App\Http\Middleware\SetLanguage;
use App\Support\AccountEmail;
use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\MailSettings;
use App\Support\PlanMaterials;
use App\Support\Qfs;
use App\Support\Reviews;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;

final class AdminContentController
{
    private const RESOURCES = [
        'documents' => ['Document', 'DOCUMENT', ['code', 'title', 'flagPath', 'fileUrl', 'sort', 'isActive']],
        'reviews' => ['Review', 'REVIEW', ['userName', 'country', 'avatarUrl', 'imageUrl', 'rating', 'text', 'status', 'sort']],
        'markets' => ['MarketAsset', 'MARKET', ['symbol', 'name', 'full', 'type', 'price', 'change', 'direction', 'color', 'sort', 'isActive']],
        'plans' => ['InvestmentPlan', 'PLAN', ['name', 'description', 'terms', 'riskDisclosure', 'documentIds', 'minAmount', 'maxAmount', 'monthlyRoiPct', 'termMonths', 'payoutInterval', 'isActive', 'sort', 'color']],
    ];

    private function spec(string $resource): array
    {
        return self::RESOURCES[$resource] ?? Guard::fail('NOT_FOUND', 'Resource not found', 404);
    }

    public function list(Request $request, string $resource): JsonResponse
    {
        Guard::admin($request);
        [$table] = $this->spec($resource);
        $query = DB::table($table);
        if ($resource === 'reviews') {
            $query->orderBy('status');
        }
        if ($resource === 'markets') {
            $query->orderBy('type');
        }

        $rows = $query->orderBy('sort')->get();
        if ($resource === 'plans') {
            $rows->each(fn ($plan) => $plan->sourceHash = PlanMaterials::sourceHash((array) $plan));
        }

        return Api::ok($rows);
    }

    private function input(Request $request, string $resource, bool $partial): array
    {
        $rules = match ($resource) {
            'documents' => [
                'code' => 'string|min:2|max:20', 'title' => 'string|min:2|max:120',
                'flagPath' => 'string|max:300', 'fileUrl' => 'string|max:500',
                'sort' => 'integer|min:0|max:10000', 'isActive' => 'boolean',
            ],
            'reviews' => [
                'userName' => 'string|min:2|max:80', 'country' => 'string|max:40',
                'avatarUrl' => 'string|max:300', 'imageUrl' => 'string|max:2048',
                'rating' => 'integer|min:1|max:5',
                'text' => 'string|min:3|max:2000', 'status' => 'string|in:APPROVED,HIDDEN,PENDING',
                'sort' => 'integer|min:0|max:10000',
            ],
            'markets' => [
                'symbol' => 'string|min:1|max:12', 'name' => 'string|min:1|max:60',
                'full' => 'string|min:1|max:80', 'type' => 'in:METAL,STOCK,CRYPTO',
                'price' => 'string|min:1|max:30', 'change' => 'string|min:1|max:20',
                'direction' => 'in:up,down,flat', 'color' => 'string|min:1|max:20',
                'sort' => 'integer|min:0|max:10000', 'isActive' => 'boolean',
            ],
            'plans' => [
                'name' => 'string|min:2|max:60', 'description' => 'string|max:300',
                'minAmount' => 'numeric|gt:0|max:1000000', 'maxAmount' => 'nullable|numeric|gt:0|max:1000000',
                'monthlyRoiPct' => 'numeric|gt:0|max:50', 'termMonths' => 'integer|min:1|max:240',
                'payoutInterval' => 'in:MONTHLY,HOURLY',
                'principalRelease' => 'in:MANUAL,AUTOMATIC',
                'terms' => 'nullable|string|max:10000', 'riskDisclosure' => 'nullable|string|max:10000',
                'translations' => 'array|max:40',
                'translations.*' => 'array:description,terms,riskDisclosure,sourceHash',
                'translations.*.description' => 'nullable|string|max:300',
                'translations.*.terms' => 'nullable|string|max:10000',
                'translations.*.riskDisclosure' => 'nullable|string|max:10000',
                'translations.*.sourceHash' => 'nullable|string|regex:/^[a-f0-9]{64}$/',
                'documentIds' => 'array|max:10', 'documentIds.*' => 'string|distinct|exists:Document,id',
                'isActive' => 'boolean', 'sort' => 'integer|min:0|max:10000', 'color' => 'string|max:20',
            ],
        };
        $required = match ($resource) {
            'documents' => ['code', 'title', 'flagPath', 'fileUrl'],
            'reviews' => ['userName', 'text', 'rating'],
            'markets' => ['symbol', 'name', 'full', 'type', 'price', 'change'],
            'plans' => ['name', 'minAmount', 'monthlyRoiPct', 'termMonths'],
        };
        foreach ($rules as $key => &$rule) {
            $rule = ($partial ? 'sometimes|' : (in_array($key, $required) ? 'required|' : 'sometimes|')).$rule;
        }
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            Guard::fail('BAD_REQUEST', $validator->errors()->first(), 400);
        }
        $data = $validator->validated();
        if ($resource === 'documents') {
            foreach (['flagPath', 'fileUrl'] as $key) {
                if (isset($data[$key]) && ! preg_match('~^(?!//)(/|https://)~i', $data[$key])) {
                    Guard::fail('BAD_REQUEST', 'Use a site path or an https:// link', 400);
                }
            }
        }
        if ($resource === 'reviews') {
            foreach (['avatarUrl', 'imageUrl'] as $imageField) {
                if (isset($data[$imageField]) && $data[$imageField] !== '' &&
                    ! preg_match('~^(?!//)(/|https://)~i', $data[$imageField])) {
                    Guard::fail('BAD_REQUEST', 'Use a site path or an https:// link', 400);
                }
            }
        }
        if ($resource === 'plans') {
            if (array_key_exists('documentIds', $data)) {
                $data['documentIds'] = json_encode(array_values($data['documentIds']));
            }
            foreach (['minAmount' => 'minAmountCents', 'maxAmount' => 'maxAmountCents'] as $field => $column) {
                if (array_key_exists($field, $data)) {
                    $cents = $data[$field] === null ? null : Qfs::cents($data[$field]);
                    if ($data[$field] !== null && $cents === null) {
                        Guard::fail('BAD_REQUEST', 'Amount can have at most 2 decimal places', 400);
                    }
                    $data[$column] = $cents;
                    unset($data[$field]);
                }
            }
            if (isset($data['monthlyRoiPct'])) {
                $data['monthlyRoiBps'] = (int) round($data['monthlyRoiPct'] * 100);
                unset($data['monthlyRoiPct']);
            }
        }
        if ($resource === 'markets' && isset($data['symbol'])) {
            $data['symbol'] = strtoupper($data['symbol']);
        }
        if ($resource === 'reviews' && isset($data['status']) && $data['status'] === 'PUBLISHED') {
            $data['status'] = 'APPROVED';
        }

        return $data;
    }

    private function prepareTranslations(array $data, ?object $previous = null): array
    {
        if (! array_key_exists('translations', $data)) {
            return $data;
        }
        $materials = [...(array) $previous, ...$data];
        $hash = PlanMaterials::sourceHash($materials);
        foreach ($data['translations'] as $locale => &$version) {
            if ($locale === 'en' || ! in_array($locale, SetLanguage::available(), true)) {
                Guard::fail('BAD_REQUEST', 'Select a supported translation language.', 400);
            }
            foreach (['description', 'terms', 'riskDisclosure'] as $key) {
                if (($version['sourceHash'] ?? $hash) === $hash && ! empty($materials[$key]) && empty(trim($version[$key] ?? ''))) {
                    Guard::fail('BAD_REQUEST', 'Complete the translated description, terms, and risk disclosure before publishing this language.', 400);
                }
            }
            $version['sourceHash'] = $version['sourceHash'] ?? $hash;
        }
        unset($version);
        $data['translations'] = json_encode($data['translations'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return $data;
    }

    public function create(Request $request, string $resource): JsonResponse
    {
        $admin = Guard::admin($request);
        [$table, $prefix] = $this->spec($resource);
        $data = $this->input($request, $resource, false);
        $id = Qfs::id();
        $data['id'] = $id;
        if ($resource === 'reviews') {
            $data['status'] = $data['status'] ?? Reviews::VISIBLE_STATUS;
        }
        if ($resource === 'plans') {
            $data = $this->prepareTranslations($data);
            $data['updatedAt'] = Qfs::now();
        }
        DB::table($table)->insert($data);
        $row = DB::table($table)->where('id', $id)->first();
        AdminLog::audit($admin->id, $prefix.'.CREATE', $table, $id);

        return Api::ok($row);
    }

    public function update(Request $request, string $resource, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        [$table, $prefix] = $this->spec($resource);
        $previous = DB::table($table)->where('id', $id)->first();
        if (! $previous) {
            Guard::fail('NOT_FOUND', 'Record not found', 404);
        }
        $data = $this->input($request, $resource, true);
        if ($resource === 'plans') {
            $data = $this->prepareTranslations($data, $previous);
            $data['updatedAt'] = Qfs::now();
        }
        if ($data) {
            DB::table($table)->where('id', $id)->update($data);
        }
        if ($resource === 'documents' && isset($data['fileUrl']) && $data['fileUrl'] !== $previous->fileUrl) {
            DocumentFileController::deleteIfUnreferenced($previous->fileUrl);
        }
        $row = DB::table($table)->where('id', $id)->first();
        AdminLog::audit($admin->id, $prefix.'.UPDATE', $table, $id);

        return Api::ok($row);
    }

    public function delete(Request $request, string $resource, string $id): JsonResponse
    {
        $admin = Guard::admin($request);
        [$table, $prefix] = $this->spec($resource);
        $previous = DB::table($table)->where('id', $id)->first();
        if (! $previous) {
            Guard::fail('NOT_FOUND', 'Record not found', 404);
        }
        if ($resource === 'plans' && DB::table('Investment')->where('planId', $id)->exists()) {
            DB::table('InvestmentPlan')->where('id', $id)->update(['isActive' => false, 'updatedAt' => Qfs::now()]);
        } else {
            DB::table($table)->where('id', $id)->delete();
        }
        if ($resource === 'documents') {
            DocumentFileController::deleteIfUnreferenced($previous->fileUrl);
        }
        AdminLog::audit($admin->id, $prefix.'.DELETE', $table, $id);

        return Api::ok(['deleted' => true]);
    }

    public function settings(Request $request): JsonResponse
    {
        Guard::admin($request);

        return Api::ok(DB::table('Setting')->orderBy('key')->get(['key', 'value'])
            ->filter(fn ($row) => ! MailSettings::isManagedKey($row->key))
            ->pluck('value', 'key'));
    }

    public function mailSettings(Request $request): JsonResponse
    {
        Guard::admin($request);
        MailSettings::applyFromDatabase();
        $values = MailSettings::storedValues();

        return Api::ok([
            'host' => $values['mail_smtp_host'] ?? '',
            'port' => $values['mail_smtp_port'] ?? '587',
            'encryption' => $values['mail_smtp_encryption'] ?? 'tls',
            'username' => $values['mail_smtp_username'] ?? '',
            'passwordConfigured' => ! empty($values['mail_smtp_password'] ?? ''),
            'fromAddress' => $values['mail_from_address'] ?? '',
            'fromName' => $values['mail_from_name'] ?? '',
            'accountEmails' => MailSettings::accountEmailsEnabled(),
            'deliveryAvailable' => AccountEmail::deliveryAvailable(),
        ]);
    }

    public function saveMailSettings(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate([
            'host' => 'required|string|max:255',
            'port' => 'required|integer|min:1|max:65535',
            'encryption' => 'nullable|string|in:tls,ssl,none',
            'username' => 'nullable|string|max:255',
            'password' => 'nullable|string|max:500',
            'fromAddress' => 'required|email|max:255',
            'fromName' => 'required|string|max:120',
            'accountEmails' => 'required|boolean',
        ]);
        MailSettings::upsert('mail_smtp_host', trim($data['host']));
        MailSettings::upsert('mail_smtp_port', (string) $data['port']);
        MailSettings::upsert('mail_smtp_encryption', $data['encryption'] ?? 'tls');
        MailSettings::upsert('mail_smtp_username', trim((string) ($data['username'] ?? '')));
        if (($data['password'] ?? '') !== '') {
            MailSettings::upsert('mail_smtp_password', $data['password']);
        }
        MailSettings::upsert('mail_from_address', strtolower(trim($data['fromAddress'])));
        MailSettings::upsert('mail_from_name', trim($data['fromName']));
        MailSettings::upsert('mail_account_emails', $data['accountEmails'] ? '1' : '0');
        AdminLog::audit($admin->id, 'MAIL.UPSERT', 'Setting', null, ['host' => trim($data['host'])]);
        MailSettings::applyFromDatabase();

        return $this->mailSettings($request);
    }

    public function testMailSettings(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate(['email' => 'required|email|max:255']);
        MailSettings::applyFromDatabase();
        if (! AccountEmail::deliveryAvailable()) {
            Guard::fail('MAIL_NOT_CONFIGURED', 'Complete SMTP host, username, and password before sending a test.', 400);
        }
        $to = strtolower(trim($data['email']));
        Mail::raw('This is a test message from QFS admin mail settings. If you received it, SMTP is working.', function ($message) use ($to): void {
            $message->to($to)->subject('QFS SMTP test');
        });
        AdminLog::audit($admin->id, 'MAIL.TEST', 'Setting', null, ['to' => $to]);

        return Api::ok(['sent' => true, 'to' => $to]);
    }

    public function saveSetting(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate(['key' => 'required|string|min:1|max:60', 'value' => 'required|string|max:4000']);
        $key = trim($data['key']);
        if (MailSettings::isManagedKey($key)) {
            Guard::fail('MAIL_SETTINGS', 'Configure email in the Email & SMTP section.', 400);
        }
        if (in_array($key, ['deposit_btc_address', 'deposit_eth_address', 'deposit_usdt_trc20', 'deposit_usdt_bep20'], true)) {
            Guard::fail('RECEIVING_WALLET', 'Manage crypto addresses in Receiving wallets.', 400);
        }
        if ($key === 'referral_rate_bps') {
            validator(['value' => $data['value']], ['value' => 'required|integer|min:0|max:10000'])->validate();
        }
        if ($key === 'crypto_withdrawals_enabled') {
            $data['value'] = MailSettings::truthy($data['value']) ? '1' : '0';
        }
        $existing = DB::table('Setting')->where('key', $key)->first();
        $id = $existing?->id ?? Qfs::id();
        DB::table('Setting')->updateOrInsert(['key' => $key], [
            'id' => $id, 'value' => $data['value'], 'updatedAt' => Qfs::now(),
        ]);
        AdminLog::audit($admin->id, 'SETTING.UPSERT', 'Setting', $id, ['key' => $key]);

        return Api::ok(DB::table('Setting')->where('key', $key)->first());
    }
}
