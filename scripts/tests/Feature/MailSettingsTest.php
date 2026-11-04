<?php

namespace Tests\Feature;

use App\Support\AccountEmail;
use App\Support\MailSettings;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MailSettingsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Schema::create('Setting', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('key')->unique();
            $t->text('value')->nullable();
            $t->dateTime('updatedAt')->nullable();
        });
    }

    public function test_database_smtp_overrides_config_and_enables_delivery_check(): void
    {
        Config::set('mail.default', 'log');
        MailSettings::upsert('mail_smtp_host', 'smtp.example.test');
        MailSettings::upsert('mail_smtp_port', '587');
        MailSettings::upsert('mail_smtp_encryption', 'tls');
        MailSettings::upsert('mail_smtp_username', 'no-reply@example.test');
        MailSettings::upsert('mail_smtp_password', 'secret');
        MailSettings::upsert('mail_from_address', 'no-reply@example.test');
        MailSettings::upsert('mail_from_name', 'QFS');
        MailSettings::upsert('mail_account_emails', '1');
        MailSettings::applyFromDatabase();
        $this->assertSame('smtp', config('mail.default'));
        $this->assertTrue(AccountEmail::deliveryAvailable());
        $this->assertTrue(MailSettings::accountEmailsEnabled());
    }

    public function test_should_email_covers_swaps_but_not_hourly_profit(): void
    {
        $this->assertTrue(AccountEmail::shouldEmailNotification('Swap completed'));
        $this->assertTrue(AccountEmail::shouldEmailNotification('Account registration successful.'));
        $this->assertFalse(AccountEmail::shouldEmailNotification('Investment profit credited'));
    }

    public function test_settings_upsert_keeps_the_existing_record_identity(): void
    {
        MailSettings::upsert('mail_smtp_host', 'old.example.test');
        $id = DB::table('Setting')->where('key', 'mail_smtp_host')->value('id');
        MailSettings::upsert('mail_smtp_host', 'new.example.test');
        $this->assertSame(1, DB::table('Setting')->count());
        $this->assertSame($id, DB::table('Setting')->value('id'));
        $this->assertSame('new.example.test', DB::table('Setting')->value('value'));
    }
}
