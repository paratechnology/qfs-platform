<?php

namespace App\Http\Controllers;

use App\Http\Middleware\SetLanguage;
use App\Support\AdminLog;
use App\Support\Api;
use App\Support\Guard;
use App\Support\PlanMaterials;
use App\Support\Qfs;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

final class AdminContentController
{
    private const RESOURCES = [
        'documents' => ['Document', 'DOCUMENT', ['code', 'title', 'flagPath', 'fileUrl', 'sort', 'isActive']],
        'reviews' => ['Review', 'REVIEW', ['userName', 'country', 'avatarUrl', 'rating', 'text', 'status', 'sort']],
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
                'avatarUrl' => 'string|max:300', 'rating' => 'integer|min:1|max:5',
                'text' => 'string|min:3|max:2000', 'status' => 'string|max:20',
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
                'translations' => 'array|max:20',
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
        if ($resource === 'reviews' && isset($data['avatarUrl']) && $data['avatarUrl'] !== '' &&
            ! preg_match('~^(?!//)(/|https://)~i', $data['avatarUrl'])) {
            Guard::fail('BAD_REQUEST', 'Use a site path or an https:// link', 400);
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
            if ($locale === 'en' || ! in_array($locale, SetLanguage::LANGUAGES, true)) {
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

        return Api::ok(DB::table('Setting')->orderBy('key')->pluck('value', 'key'));
    }

    public function saveSetting(Request $request): JsonResponse
    {
        $admin = Guard::admin($request);
        $data = $request->validate(['key' => 'required|string|min:1|max:60', 'value' => 'required|string|max:4000']);
        $key = trim($data['key']);
        if (in_array($key, ['deposit_btc_address', 'deposit_eth_address', 'deposit_usdt_trc20', 'deposit_usdt_bep20'], true)) {
            Guard::fail('RECEIVING_WALLET', 'Manage crypto addresses in Receiving wallets.', 400);
        }
        if ($key === 'referral_rate_bps') {
            validator(['value' => $data['value']], ['value' => 'required|integer|min:0|max:10000'])->validate();
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
