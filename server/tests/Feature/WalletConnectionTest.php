<?php

namespace Tests\Feature;

use App\Support\SessionAuth;
use App\Support\WalletCrypto;
use Elliptic\EC;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use kornrunner\Keccak;
use Tests\TestCase;

class WalletConnectionTest extends TestCase
{
    private const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

    private const PRIVATE_KEY = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        config()->set('qfs.public_url', 'https://qfs.test');
        RateLimiter::clear('wallet:challenge:user-1');
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('email');
            $t->string('name');
            $t->string('role')->default('USER');
            $t->string('status')->default('ACTIVE');
            $t->string('avatarUrl')->default('');
            $t->string('country')->default('');
            $t->string('referralCode')->default('');
            $t->timestamp('memberSince')->useCurrent();
            $t->integer('kycLevel')->default(0);
        });
        Schema::create('Session', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('tokenHash');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('WalletNonce', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('nonce');
            $t->text('message');
            $t->timestamp('expiresAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('WalletConnection', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('address');
            $t->integer('chainId');
            $t->string('label')->default('');
            $t->timestamp('lastUsedAt');
            $t->timestamp('createdAt')->useCurrent();
        });
        Schema::create('AuditLog', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('actorId');
            $t->string('actorRole');
            $t->string('action');
            $t->string('targetType');
            $t->string('targetId')->nullable();
            $t->text('meta')->nullable();
        });
        DB::table('User')->insert(['id' => 'user-1', 'email' => 'wallet@test.local', 'name' => 'Wallet User']);
        $this->token = SessionAuth::issue('user-1');
    }

    private function signature(string $message, string $private = self::PRIVATE_KEY): string
    {
        $hash = Keccak::hash("\x19Ethereum Signed Message:\n".strlen($message).$message, 256);
        $signed = (new EC('secp256k1'))->sign($hash, $private);

        return '0x'.str_pad($signed->r->toString(16), 64, '0', STR_PAD_LEFT)
            .str_pad($signed->s->toString(16), 64, '0', STR_PAD_LEFT)
            .str_pad(dechex(27 + $signed->recoveryParam), 2, '0', STR_PAD_LEFT);
    }

    public function test_signature_links_wallet_once_and_disconnects_it(): void
    {
        $challenge = $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/challenge', ['address' => self::ADDRESS])
            ->assertOk()->json('data');
        $this->assertStringContainsString('https://qfs.test', $challenge['message']);
        $proof = ['address' => self::ADDRESS, 'nonce' => $challenge['nonce'],
            'signature' => $this->signature($challenge['message']), 'chainId' => 1];
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', $proof)
            ->assertOk()->assertJsonPath('data.address', self::ADDRESS);
        $this->assertSame(1, DB::table('WalletConnection')->count());
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', $proof)->assertStatus(400);
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->getJson('/api/wallet')->assertOk()->assertJsonCount(1, 'data.wallets');
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet', ['address' => self::ADDRESS])->assertOk();
        $this->assertSame(0, DB::table('WalletConnection')->count());
    }

    public function test_wrong_signer_and_changed_address_are_rejected(): void
    {
        $challenge = $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/challenge', ['address' => self::ADDRESS])->json('data');
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', [
                'address' => self::ADDRESS, 'nonce' => $challenge['nonce'],
                'signature' => $this->signature($challenge['message'], str_repeat('1', 64)), 'chainId' => 1,
            ])->assertStatus(400);
        $this->assertSame(0, DB::table('WalletConnection')->count());
        $this->assertNull(WalletCrypto::address('0x70997970c51812dc3A010C7d01b50e0d17dc79C8'));
    }

    public function test_bnb_smart_chain_wallet_connects_without_switching_to_ethereum(): void
    {
        $challenge = $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/challenge', ['address' => self::ADDRESS])
            ->assertOk()->assertJsonPath('data.chainIds', [1, 56])->json('data');
        $proof = ['address' => self::ADDRESS, 'nonce' => $challenge['nonce'],
            'signature' => $this->signature($challenge['message']), 'chainId' => 56];
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', $proof)->assertOk()->assertJsonPath('data.chainId', 56);
        $this->assertSame(56, DB::table('WalletConnection')->value('chainId'));
    }

    public function test_unsupported_chain_cannot_link_a_wallet(): void
    {
        $challenge = $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/challenge', ['address' => self::ADDRESS])->assertOk()->json('data');
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', ['address' => self::ADDRESS, 'nonce' => $challenge['nonce'],
                'signature' => $this->signature($challenge['message']), 'chainId' => 137])->assertStatus(400);
        $this->assertSame(0, DB::table('WalletConnection')->count());
    }

    public function test_expired_or_other_users_challenge_cannot_connect(): void
    {
        $challenge = $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/challenge', ['address' => self::ADDRESS])->json('data');
        $proof = ['address' => self::ADDRESS, 'nonce' => $challenge['nonce'],
            'signature' => $this->signature($challenge['message']), 'chainId' => 1];
        DB::table('User')->insert(['id' => 'user-2', 'email' => 'other@test.local', 'name' => 'Other User']);
        $otherToken = SessionAuth::issue('user-2');
        $this->withUnencryptedCookie('qfs_session', $otherToken)
            ->postJson('/api/wallet/verify', $proof)->assertStatus(400);
        DB::table('WalletNonce')->where('nonce', $challenge['nonce'])
            ->update(['expiresAt' => now()->subMinute()]);
        $this->withUnencryptedCookie('qfs_session', $this->token)
            ->postJson('/api/wallet/verify', $proof)->assertStatus(400);
        $this->assertSame(0, DB::table('WalletConnection')->count());
    }
}
