<?php

namespace Tests\Feature;

use App\Support\Earnings;
use App\Support\InvestmentLifecycle;
use App\Support\PlanMaterials;
use App\Support\SessionAuth;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class InvestmentEarningsTest extends TestCase
{
    private string $userToken;

    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('name');
            $t->string('email');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->string('referredById')->nullable();
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt');
        });
        foreach (['Notification', 'AuditLog'] as $name) {
            Schema::create($name, function (Blueprint $t) use ($name) {
                $t->string('id')->primary();
                if ($name === 'Notification') {
                    $t->string('userId');
                    $t->string('title');
                    $t->text('body')->nullable();
                    $t->text('messageParams')->nullable();
                } else {
                    $t->string('actorId');
                    $t->string('actorRole');
                    $t->string('action');
                    $t->string('targetType');
                    $t->string('targetId')->nullable();
                    $t->text('meta')->nullable();
                }
            });
        }
        DB::table('User')->insert([
            ['id' => 'user', 'name' => 'Investor', 'email' => 'investor@test.local', 'role' => 'USER'],
            ['id' => 'admin', 'name' => 'Admin', 'email' => 'admin@test.local', 'role' => 'ADMIN'],
        ]);
        $this->userToken = SessionAuth::issue('user');
        $this->adminToken = SessionAuth::issue('admin');
        Schema::create('InvestmentPlan', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('name');
            $t->integer('monthlyRoiBps');
            $t->integer('termMonths');
            $t->string('payoutInterval');
            $t->string('principalRelease')->default('MANUAL');
            $t->boolean('isActive')->default(true);
            $t->integer('minAmountCents')->default(10000);
            $t->integer('maxAmountCents')->nullable();
            $t->integer('sort')->default(0);
            $t->text('description')->nullable();
            $t->text('terms')->nullable();
            $t->text('riskDisclosure')->nullable();
            $t->text('translations')->nullable();
            $t->text('documentIds')->default('[]');
            $t->timestamp('updatedAt')->nullable();
        });
        Schema::create('Investment', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('planId');
            $t->string('status')->default('ACTIVE');
            $t->integer('amountCents');
            $t->timestamp('startDate');
            $t->timestamp('endDate')->nullable();
            $t->integer('monthlyRoiBps');
            $t->integer('termMonths');
            $t->string('payoutInterval');
            $t->string('principalRelease')->default('MANUAL');
            $t->timestamp('maturedAt')->nullable();
            $t->timestamp('principalReturnedAt')->nullable();
            $t->timestamp('createdAt')->useCurrent();
            $t->integer('paidOutCents')->default(0);
            $t->text('materials')->nullable();
        });
        Schema::create('Account', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->integer('balanceCents');
            $t->integer('availableCents');
            $t->timestamp('updatedAt')->nullable();
        });
        Schema::create('Transaction', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('type');
            $t->integer('amountCents');
            $t->string('reference')->unique();
            $t->string('status');
            $t->timestamp('completedAt')->nullable();
            $t->string('note')->nullable();
            $t->string('meta')->nullable();
            $t->string('method')->nullable();
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('LedgerEntry', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('accountId');
            $t->string('movement');
            $t->integer('amountCents');
            $t->integer('balanceAfterCents');
            $t->string('txId');
            $t->string('note');
        });
        DB::table('Account')->insert(['id' => 'account', 'userId' => 'user', 'balanceCents' => 10000, 'availableCents' => 10000]);
        Schema::create('Document', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('title');
            $t->string('fileUrl');
            $t->boolean('isActive');
        });
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function investment(string $interval, string $start = '2026-01-31 00:00:00'): void
    {
        DB::table('InvestmentPlan')->insert([
            'id' => 'plan', 'name' => 'Growth', 'monthlyRoiBps' => 350,
            'termMonths' => 3, 'payoutInterval' => $interval,
        ]);
        DB::table('Investment')->insert([
            'id' => 'investment', 'userId' => 'user', 'planId' => 'plan', 'status' => 'ACTIVE',
            'amountCents' => 10000, 'startDate' => $start, 'monthlyRoiBps' => 350,
            'termMonths' => 3, 'payoutInterval' => $interval,
        ]);
    }

    public function test_monthly_plan_accrues_hourly_and_only_pays_on_anniversary(): void
    {
        $this->investment('MONTHLY');
        CarbonImmutable::setTestNow('2026-02-01 01:00:00 UTC');
        $this->assertSame(0, Earnings::forUser('user')['credited']);
        $this->assertSame('$0.1302', Earnings::pendingForUser('user')['pending']);
        $this->assertSame(10000, DB::table('Account')->value('availableCents'));
        CarbonImmutable::setTestNow('2026-02-28 00:00:00 UTC');
        $this->assertSame(350, Earnings::forUser('user')['totalCents']);
        $this->assertSame(0, Earnings::forUser('user')['credited']);
        $this->assertSame(10350, DB::table('Account')->value('availableCents'));
        $this->assertSame('$0.0000', Earnings::pendingForUser('user')['pending']);
    }

    public function test_hourly_plan_credits_cumulative_rounding_and_keeps_snapshot_terms(): void
    {
        $this->investment('HOURLY', '2026-01-01 00:00:00');
        DB::table('InvestmentPlan')->where('id', 'plan')->update([
            'monthlyRoiBps' => 900, 'payoutInterval' => 'MONTHLY',
        ]);
        CarbonImmutable::setTestNow('2026-01-01 01:00:00 UTC');
        $this->assertSame(0, Earnings::forUser('user')['totalCents']);
        CarbonImmutable::setTestNow('2026-01-02 00:00:00 UTC');
        $this->assertSame(11, Earnings::forUser('user')['totalCents']);
        $this->assertSame(0, Earnings::forUser('user')['credited']);
        CarbonImmutable::setTestNow('2026-02-01 00:00:00 UTC');
        $this->assertSame(339, Earnings::forUser('user')['totalCents']);
        $this->assertSame(10350, DB::table('Account')->value('availableCents'));
        $this->assertSame(350, DB::table('Investment')->value('paidOutCents'));
    }

    public function test_investment_materials_keep_original_terms_and_document_version(): void
    {
        $this->investment('MONTHLY');
        DB::table('Document')->insert(['id' => 'doc', 'title' => 'Plan conditions', 'fileUrl' => '/api/documents/files/original.pdf', 'isActive' => true]);
        DB::table('InvestmentPlan')->where('id', 'plan')->update(['terms' => 'Original plan conditions', 'documentIds' => '["doc"]']);
        $snapshot = PlanMaterials::snapshot(DB::table('InvestmentPlan')->first());
        DB::table('Investment')->where('id', 'investment')->update(['materials' => $snapshot]);
        DB::table('InvestmentPlan')->where('id', 'plan')->update(['terms' => 'Updated conditions']);
        DB::table('Document')->where('id', 'doc')->update(['fileUrl' => '/api/documents/files/replaced.pdf']);
        CarbonImmutable::setTestNow('2026-02-01 01:00:00 UTC');
        $item = Earnings::pendingForUser('user')['items'][0];
        $this->assertSame('Original plan conditions', $item['terms']);
        $this->assertSame('/api/documents/files/original.pdf', $item['documents'][0]['fileUrl']);
        $this->assertSame('INVESTMENT', $item['materialsSource']);
        $this->assertSame(3, $item['termMonths']);
        $this->assertSame('2026-02-28T00:00:00+00:00', $item['nextPayoutAt']);
        $this->assertSame('$10.50', $item['totalExpectedProfit']);
    }

    public function test_only_admins_can_publish_complete_plan_language_versions(): void
    {
        $body = ['name' => 'Global', 'minAmount' => 100, 'monthlyRoiPct' => 3.5, 'termMonths' => 3, 'payoutInterval' => 'MONTHLY',
            'description' => 'Original description', 'terms' => 'Original conditions', 'riskDisclosure' => 'Capital is at risk',
            'translations' => ['es' => ['description' => 'Descripción original', 'terms' => 'Condiciones originales', 'riskDisclosure' => 'El capital está en riesgo']]];
        $this->withUnencryptedCookie('qfs_session', $this->userToken)->postJson('/api/admin/plans', $body)->assertForbidden();
        $created = $this->withUnencryptedCookie('qfs_session', $this->adminToken)->postJson('/api/admin/plans', $body)->assertOk();
        $plan = DB::table('InvestmentPlan')->where('id', $created->json('data.id'))->first();
        app()->setLocale('es');
        $materials = PlanMaterials::localize(PlanMaterials::forPlan($plan));
        $this->assertSame('Condiciones originales', $materials['terms']);
        $this->assertSame('Original conditions', $materials['originalMaterials']['terms']);
        $this->assertSame('es', $materials['contentLanguage']);
        $this->assertArrayNotHasKey('translations', $materials);
        $this->assertSame(350, $plan->monthlyRoiBps);
        $body['translations']['es']['riskDisclosure'] = '';
        $this->postJson('/api/admin/plans', $body)->assertStatus(400);
        $body['translations'] = ['unsupported' => []];
        $this->postJson('/api/admin/plans', $body)->assertStatus(400);
        $this->assertSame(1, DB::table('InvestmentPlan')->count());
    }

    public function test_stale_translations_fall_back_while_purchase_keeps_recorded_language_versions(): void
    {
        $this->investment('MONTHLY');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->patchJson('/api/admin/plans/plan', [
            'terms' => 'Original conditions', 'translations' => ['es' => ['terms' => 'Condiciones originales']],
        ])->assertOk();
        $plan = DB::table('InvestmentPlan')->first();
        DB::table('Investment')->update(['materials' => PlanMaterials::snapshot($plan)]);
        $version = json_decode($plan->translations, true);
        $this->patchJson('/api/admin/plans/plan', ['terms' => 'Revised conditions', 'riskDisclosure' => 'New risk disclosure', 'translations' => $version])->assertOk();
        app()->setLocale('es');
        $current = PlanMaterials::localize(PlanMaterials::forPlan(DB::table('InvestmentPlan')->first()));
        $this->assertSame('Revised conditions', $current['terms']);
        $this->assertSame('en', $current['contentLanguage']);
        $this->assertArrayNotHasKey('originalMaterials', $current);
        CarbonImmutable::setTestNow('2026-02-01 01:00:00 UTC');
        $item = Earnings::pendingForUser('user')['items'][0];
        $this->assertSame('Condiciones originales', $item['terms']);
        $this->assertSame('Original conditions', $item['originalMaterials']['terms']);
        $this->assertSame('es', $item['contentLanguage']);
        $this->assertSame(350, DB::table('Investment')->value('monthlyRoiBps'));
        app()->setLocale('de');
        $this->assertSame('Original conditions', Earnings::pendingForUser('user')['items'][0]['terms']);
        $this->assertSame('en', Earnings::pendingForUser('user')['items'][0]['contentLanguage']);
    }

    public function test_maturity_waits_for_final_profit_and_manual_release_restores_only_available_balance(): void
    {
        $this->investment('MONTHLY');
        DB::table('Account')->update(['balanceCents' => 20000, 'availableCents' => 8000]);
        CarbonImmutable::setTestNow('2026-04-29 23:59:59 UTC');
        $this->assertSame(700, Earnings::forUser('user')['totalCents']);
        $this->assertFalse(InvestmentLifecycle::mature('user', 'investment'));
        $this->assertSame('ACTIVE', DB::table('Investment')->value('status'));
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertStatus(409);
        CarbonImmutable::setTestNow('2026-04-30 00:00:00 UTC');
        $this->assertSame(350, Earnings::forUser('user')['totalCents']);
        $this->assertSame('MATURED', DB::table('Investment')->value('status'));
        $this->assertSame(1050, DB::table('Investment')->value('paidOutCents'));
        $this->assertSame(9050, DB::table('Account')->value('availableCents'));
        $this->assertSame([], Earnings::pendingForUser('user')['items']);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertOk()->assertJsonPath('data.released', true);
        $this->assertSame(21050, DB::table('Account')->value('balanceCents'));
        $this->assertSame(19050, DB::table('Account')->value('availableCents'));
        $this->assertSame('CLOSED', DB::table('Investment')->value('status'));
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertOk()->assertJsonPath('data.released', false);
        $this->assertSame(1, DB::table('Transaction')->where('type', 'PRINCIPAL_RETURN')->count());
        $this->assertSame(1, DB::table('AuditLog')->where('action', 'INVESTMENT.PRINCIPAL_RELEASE')->count());
        $this->assertSame(0, Earnings::sweep()['credited']);
        $this->assertSame(1050, DB::table('Investment')->value('paidOutCents'));
    }

    public function test_automatic_hourly_maturity_pays_final_profit_and_returns_principal_once(): void
    {
        $this->investment('HOURLY', '2026-01-01 00:00:00');
        DB::table('Account')->update(['balanceCents' => 20000, 'availableCents' => 10000]);
        DB::table('Investment')->update(['principalRelease' => 'AUTOMATIC']);
        CarbonImmutable::setTestNow('2026-04-01 00:00:00 UTC');
        $this->assertSame(1050, Earnings::sweep()['totalCents']);
        $this->assertSame('CLOSED', DB::table('Investment')->value('status'));
        $this->assertNotNull(DB::table('Investment')->value('principalReturnedAt'));
        $this->assertSame(21050, DB::table('Account')->value('balanceCents'));
        $this->assertSame(21050, DB::table('Account')->value('availableCents'));
        $this->assertSame(0, Earnings::sweep()['credited']);
        $this->assertSame(2, DB::table('LedgerEntry')->count());
        $this->assertSame(1, DB::table('Transaction')->where('type', 'PRINCIPAL_RETURN')->count());
    }

    public function test_plan_release_policy_is_validated_and_snapshotted_for_new_investments(): void
    {
        $this->investment('MONTHLY');
        DB::table('Investment')->delete();
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/plans/plan', ['principalRelease' => 'INVALID'])->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/plans/plan', ['principalRelease' => 'AUTOMATIC'])->assertOk();
        $created = $this->withUnencryptedCookie('qfs_session', $this->userToken)
            ->postJson('/api/investments', ['planId' => 'plan', 'amount' => 100, 'reference' => 'INV-snapshot']);
        $created->assertOk()->assertJsonPath('data.investment.principalRelease', 'AUTOMATIC');
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/plans/plan', ['principalRelease' => 'MANUAL'])->assertOk();
        $this->assertSame('AUTOMATIC', DB::table('Investment')->value('principalRelease'));
        $this->assertSame(0, DB::table('Account')->value('availableCents'));
    }

    public function test_unpaid_or_inconsistent_accounts_cannot_release_principal(): void
    {
        $this->investment('MONTHLY');
        CarbonImmutable::setTestNow('2026-04-30 00:00:00 UTC');
        $this->assertFalse(InvestmentLifecycle::mature('user', 'investment'));
        DB::table('Investment')->update(['status' => 'MATURED']);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertStatus(409);
        DB::table('Investment')->update(['paidOutCents' => 1050]);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)
            ->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertStatus(409);
        $this->assertSame(0, DB::table('Transaction')->count());
        $this->assertSame(0, DB::table('AuditLog')->count());
        $this->assertNull(DB::table('Investment')->value('principalReturnedAt'));
    }

    public function test_completed_history_is_private_paginated_and_admin_release_is_protected(): void
    {
        $this->investment('MONTHLY');
        DB::table('Investment')->update(['status' => 'MATURED', 'paidOutCents' => 1050, 'maturedAt' => '2026-04-30 00:00:00']);
        CarbonImmutable::setTestNow('2026-05-01 00:00:00 UTC');
        for ($i = 0; $i < 11; $i++) {
            DB::table('Investment')->insert(['id' => 'history-'.$i, 'userId' => 'user', 'planId' => 'plan', 'status' => 'CLOSED',
                'amountCents' => 10000, 'startDate' => '2026-01-01 00:00:00', 'monthlyRoiBps' => 350,
                'termMonths' => 3, 'payoutInterval' => 'MONTHLY', 'createdAt' => '2026-01-01 00:00:00']);
        }
        DB::table('Investment')->insert(['id' => 'foreign', 'userId' => 'other', 'planId' => 'plan', 'status' => 'CLOSED',
            'amountCents' => 10000, 'startDate' => '2026-01-01 00:00:00', 'monthlyRoiBps' => 350, 'termMonths' => 3, 'payoutInterval' => 'MONTHLY']);
        $page = $this->withUnencryptedCookie('qfs_session', $this->userToken)->getJson('/api/investments');
        $page->assertOk()->assertJsonCount(10, 'data.items');
        $cursor = $page->json('data.nextCursor');
        $this->assertNotNull($cursor);
        $next = $this->getJson('/api/investments?cursor='.$cursor)->assertOk()->assertJsonCount(2, 'data.items');
        $ids = array_merge(array_column($page->json('data.items'), 'id'), array_column($next->json('data.items'), 'id'));
        $this->assertCount(12, array_unique($ids));
        $this->assertNotContains('foreign', $ids);
        $this->getJson('/api/investments?cursor=foreign')->assertStatus(400);
        $this->getJson('/api/admin/investments')->assertStatus(403);
        $this->patchJson('/api/admin/investments/investment', ['action' => 'RELEASE_PRINCIPAL'])->assertStatus(403);
        $this->withUnencryptedCookie('qfs_session', $this->adminToken)->getJson('/api/admin/investments')->assertOk()->assertJsonCount(1, 'data');
    }
}
