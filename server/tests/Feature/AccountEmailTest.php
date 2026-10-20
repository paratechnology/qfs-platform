<?php

namespace Tests\Feature;

use App\Jobs\SendAccountEmail;
use App\Mail\AccountUpdateMail;
use App\Support\AccountEmail;
use App\Support\AdminLog;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AccountEmailTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('qfs.account_emails', true);
        config()->set('qfs.public_url', 'https://q-arculuspro.live');
        config()->set('qfs.support_email', 'support@q-arculuspro.live');
        config()->set('mail.default', 'array');
        Mail::fake();
        Queue::fake();
        Schema::create('User', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('name');
            $t->string('email');
            $t->string('status')->default('ACTIVE');
            $t->string('locale')->default('en');
        });
        Schema::create('Notification', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('userId');
            $t->string('title');
            $t->string('body')->nullable();
            $t->text('messageParams')->nullable();
        });
        DB::table('User')->insert(['id' => 'member', 'name' => 'Example Member', 'email' => 'member@example.test']);
    }

    public function test_mail_is_queued_after_commit_and_rollbacks_do_not_send(): void
    {
        DB::beginTransaction();
        AdminLog::notify('member', 'Deposit approved', 'Your deposit has been approved and credited to your account.');
        Queue::assertNothingPushed();
        DB::commit();
        Queue::assertPushed(SendAccountEmail::class, fn ($job) => $job->queue === 'mail' && $job->connection === 'database');
        Queue::assertPushed(SendAccountEmail::class, 1);
        Mail::assertNothingSent();
        Queue::fake();
        DB::beginTransaction();
        AdminLog::notify('member', 'Withdrawal approved', 'Your withdrawal has been approved and paid out.');
        DB::rollBack();
        Queue::assertNothingPushed();
        $this->assertSame(1, DB::table('Notification')->count());
    }

    public function test_log_mailer_or_incomplete_smtp_never_claims_live_delivery(): void
    {
        config()->set('mail.default', 'log');
        AdminLog::notify('member', 'Deposit approved');
        $this->assertFalse(AccountEmail::deliveryAvailable());
        Queue::assertNothingPushed();
        config()->set('mail.default', 'smtp');
        config()->set('mail.mailers.smtp', ['transport' => 'smtp', 'host' => 'mail.example.test', 'username' => '', 'password' => '']);
        $this->assertFalse(AccountEmail::deliveryAvailable());
        config()->set('mail.mailers.smtp.username', 'no-reply@example.test');
        config()->set('mail.mailers.smtp.password', 'test-only');
        $this->assertTrue(AccountEmail::deliveryAvailable());
    }

    public function test_delivery_uses_current_recipient_canonical_links_and_support_reply_address(): void
    {
        DB::table('User')->update(['locale' => 'fr']);
        $previousLocale = app()->getLocale();
        AdminLog::notify('member', 'Deposit approved', 'Your deposit has been approved and credited to your account.');
        (new SendAccountEmail(DB::table('Notification')->value('id')))->handle();
        $this->assertSame($previousLocale, app()->getLocale());
        Mail::assertSent(AccountUpdateMail::class, function ($mail) {
            $this->assertSame('https://q-arculuspro.live/user/user/dashboard/transactions', $mail->actionUrl);
            $this->assertSame('support@q-arculuspro.live', $mail->envelope()->replyTo[0]->address);
            $this->assertStringContainsString('Example Member', $mail->render());
            $this->assertNotSame('Deposit approved', $mail->title);

            return $mail->hasTo('member@example.test');
        });
        $this->assertSame('https://q-arculuspro.live/user/user/login', AccountEmail::actionUrl('Account registration successful.'));
    }

    public function test_mail_failures_remain_retryable_and_inactive_accounts_are_skipped(): void
    {
        AdminLog::notify('member', 'Withdrawal approved');
        $job = new SendAccountEmail(DB::table('Notification')->value('id'));
        $this->assertSame(5, $job->tries);
        $this->assertSame([60, 300, 900, 1800], $job->backoff());
        DB::table('User')->update(['status' => 'SUSPENDED']);
        $job->handle();
        Mail::assertNothingSent();
        DB::table('User')->update(['status' => 'ACTIVE']);
        config()->set('mail.default', 'log');
        $this->expectException(\RuntimeException::class);
        $job->handle();
    }

    public function test_earnings_notifications_do_not_generate_hourly_email_spam(): void
    {
        AdminLog::notify('member', 'Investment profit credited', 'Profit credited');
        Queue::assertNothingPushed();
    }
}
