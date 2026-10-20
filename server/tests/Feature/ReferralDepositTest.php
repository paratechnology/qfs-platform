<?php

namespace Tests\Feature;

use App\Support\ReferralRewards;
use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReferralDepositTest extends CryptoFundingTest
{
    private string $referralAdmin;

    private string $referralMember;

    protected function setUp(): void
    {
        parent::setUp();
        Schema::table('Setting', fn (Blueprint $t) => $t->timestamp('updatedAt')->nullable());
        Schema::create('ReferralEarning', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('referrerId');
            $t->string('referredUserId');
            $t->string('investmentId')->unique();
            $t->integer('amountCents');
            $t->string('status')->default('PAID');
            $t->timestamp('createdAt')->useCurrent();
        });
        (require database_path('migrations/2026_10_18_001718_reward_referrals_on_approved_deposits.php'))->up();
        DB::table('User')->insert(['id' => 'inviter', 'name' => 'Inviter', 'email' => 'inviter@example.test']);
        DB::table('Account')->insert(['id' => 'inviter-account', 'userId' => 'inviter', 'balanceCents' => 0, 'availableCents' => 0]);
        $this->referralAdmin = SessionAuth::issue('admin');
        $this->referralMember = SessionAuth::issue('user');
    }

    private function referredDeposit(string $reference = 'referral-deposit'): string
    {
        DB::table('User')->where('id', 'user')->update(['referredById' => 'inviter']);

        return $this->withUnencryptedCookie('qfs_session', $this->referralMember)
            ->postJson('/api/wallet/deposits', ['walletId' => 'receiving', 'quantity' => '0.5', 'reference' => $reference])
            ->assertOk()->json('data.request.id');
    }

    private function reviewReferral(string $id, string $action = 'APPROVE'): void
    {
        $this->withUnencryptedCookie('qfs_session', $this->referralAdmin)
            ->patchJson('/api/admin/requests/'.$id, ['action' => $action])->assertOk();
    }

    public function test_referral_crypto_deposit_pays_five_percent_usd_once_per_approved_deposit(): void
    {
        $id = $this->referredDeposit();
        $this->assertSame(0, DB::table('ReferralEarning')->count());
        $this->reviewReferral($id);
        $reward = DB::table('ReferralEarning')->first();
        $this->assertSame('PAID', $reward->status);
        $this->assertSame(100000, $reward->baseAmountCents);
        $this->assertSame(5000, $reward->amountCents);
        $this->assertSame(500, $reward->rateBps);
        $this->assertSame($id, $reward->depositRequestId);
        $this->assertNull($reward->investmentId);
        $this->assertSame('2000', json_decode($reward->valuation, true)['rateUsd']);
        $this->assertSame(5000, DB::table('Account')->where('userId', 'inviter')->value('availableCents'));
        $this->assertSame('500000000000000000', DB::table('CryptoBalance')->where('userId', 'user')->value('totalAtomic'));
        $this->reviewReferral($id);
        $this->assertSame(0, ReferralRewards::sweep());
        $this->assertSame(1, DB::table('Transaction')->where('type', 'REFERRAL_BONUS')->count());
        $this->assertSame(1, DB::table('LedgerEntry')->where('accountId', 'inviter-account')->count());
        $this->reviewReferral($this->referredDeposit('second-referral-deposit'));
        $this->assertSame(10000, DB::table('Account')->where('userId', 'inviter')->value('availableCents'));
        $this->assertSame(2, DB::table('ReferralEarning')->count());
    }

    public function test_referral_reward_waits_for_fresh_price_without_blocking_deposit_and_snapshots_rate(): void
    {
        config()->set('test.cryptoTimestamp', now()->subMinutes(3)->timestamp);
        Cache::forget('qfs.funding.prices.v1');
        $id = $this->referredDeposit();
        $this->reviewReferral($id);
        $this->assertSame('APPROVED', DB::table('DepositRequest')->where('id', $id)->value('status'));
        $reward = DB::table('ReferralEarning')->first();
        $this->assertSame('PENDING', $reward->status);
        $this->assertSame(0, $reward->amountCents);
        $this->assertSame('500000000000000000', DB::table('CryptoBalance')->value('totalAtomic'));
        DB::table('Setting')->where('key', 'referral_rate_bps')->update(['value' => '900']);
        $this->assertFalse(ReferralRewards::settle($reward->id, ['ETH' => ['rate' => '2000', 'timestamp' => now()->subMinutes(3)->timestamp]]));
        $this->assertTrue(ReferralRewards::settle($reward->id, ['ETH' => ['rate' => '2000', 'timestamp' => now()->timestamp]]));
        $this->assertFalse(ReferralRewards::settle($reward->id, ['ETH' => ['rate' => '3000', 'timestamp' => now()->timestamp]]));
        $this->assertSame(5000, DB::table('Account')->where('userId', 'inviter')->value('availableCents'));
        $this->assertSame(500, DB::table('ReferralEarning')->value('rateBps'));
    }

    public function test_referral_cash_deposit_uses_confirmed_usd_amount_and_rounds_down_to_cents(): void
    {
        DB::table('User')->where('id', 'user')->update(['referredById' => 'inviter']);
        DB::table('DepositRequest')->insert(['id' => 'cash-referral', 'userId' => 'user', 'amountCents' => 10001,
            'method' => 'Bank Transfer', 'reference' => 'cash-referral']);
        $this->reviewReferral('cash-referral');
        $this->assertSame(500, DB::table('ReferralEarning')->value('amountCents'));
        $this->assertSame(20001, DB::table('Account')->where('userId', 'user')->value('availableCents'));
        $this->reviewReferral('cash-referral');
        $this->assertSame(1, DB::table('ReferralEarning')->count());
    }

    public function test_referral_rejected_deposits_and_self_referrals_do_not_pay_rewards(): void
    {
        $this->reviewReferral($this->referredDeposit(), 'REJECT');
        $this->assertSame(0, DB::table('ReferralEarning')->count());
        DB::table('User')->where('id', 'user')->update(['referredById' => 'user']);
        $selfId = $this->referredDeposit('self-referral');
        DB::table('User')->where('id', 'user')->update(['referredById' => 'user']);
        $this->reviewReferral($selfId);
        $this->assertSame(0, DB::table('ReferralEarning')->count());
    }

    public function test_referral_reward_waits_for_recipient_account_and_preserves_valuation(): void
    {
        DB::table('User')->where('id', 'inviter')->update(['status' => 'SUSPENDED']);
        $this->reviewReferral($this->referredDeposit());
        $reward = DB::table('ReferralEarning')->first();
        $this->assertSame('PENDING', $reward->status);
        $this->assertSame(100000, $reward->baseAmountCents);
        DB::table('User')->where('id', 'inviter')->update(['status' => 'ACTIVE']);
        $this->assertTrue(ReferralRewards::settle($reward->id, []));
        $this->assertSame(5000, DB::table('ReferralEarning')->value('amountCents'));
    }

    public function test_referral_investing_deposited_funds_does_not_pay_a_second_bonus(): void
    {
        $this->reviewReferral($this->referredDeposit());
        DB::table('InvestmentPlan')->insert(['id' => 'referral-plan', 'name' => 'Starter', 'monthlyRoiBps' => 1000,
            'termMonths' => 3, 'payoutInterval' => 'HOURLY']);
        $this->withUnencryptedCookie('qfs_session', $this->referralMember)
            ->postJson('/api/investments', ['planId' => 'referral-plan', 'amount' => 100, 'reference' => 'referral-investment'])
            ->assertOk();
        $this->assertSame(1, DB::table('ReferralEarning')->count());
        $this->assertSame(5000, DB::table('Account')->where('userId', 'inviter')->value('availableCents'));
    }

    public function test_referral_rewards_roll_back_with_deposit_approval(): void
    {
        $id = $this->referredDeposit();
        DB::beginTransaction();
        $this->reviewReferral($id);
        $this->assertSame(1, DB::table('ReferralEarning')->count());
        DB::rollBack();
        $this->assertSame('PENDING', DB::table('DepositRequest')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('ReferralEarning')->count());
        $this->assertSame(0, DB::table('Transaction')->count());
        $this->assertSame(0, DB::table('Account')->where('userId', 'inviter')->value('balanceCents'));
    }
}
