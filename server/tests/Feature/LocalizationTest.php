<?php

namespace Tests\Feature;

use App\Http\Middleware\SetLanguage;
use App\Mail\PasswordRecoveryMail;
use App\Support\AdminLog;
use App\Support\LocalizedText;
use App\Support\Qfs;
use App\Support\SessionAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LocalizationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withCredentials();
        config()->set('qfs.session_secret', str_repeat('x', 64));
        Schema::create('User', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('name');
            $table->string('passwordHash');
            $table->string('role')->default('USER');
            $table->string('status')->default('ACTIVE');
            $table->string('avatarUrl')->default('');
            $table->string('country')->default('');
            $table->string('referralCode')->default('');
            $table->integer('kycLevel')->default(0);
            $table->timestamp('memberSince')->useCurrent();
            $table->timestamp('lastLoginAt')->nullable();
            $table->timestamp('updatedAt')->useCurrent();
        });
        Schema::create('Session', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('tokenHash');
            $table->timestamp('expiresAt');
            $table->timestamp('createdAt')->useCurrent();
        });
        Schema::create('InvestmentPlan', fn (Blueprint $table) => $table->string('id')->primary());
        Schema::create('Notification', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('title');
            $table->text('body')->nullable();
            $table->string('link')->nullable();
            $table->timestamp('readAt')->nullable();
            $table->timestamp('createdAt')->useCurrent();
        });
        (require database_path('migrations/2026_10_11_102744_add_localization_preferences_and_materials.php'))->up();
        (require database_path('migrations/2026_10_16_220933_add_account_security.php'))->up();
        DB::table('User')->insert([
            ['id' => 'investor', 'email' => 'investor@example.test', 'name' => 'Investor', 'passwordHash' => Hash::make('OriginalPass94'), 'locale' => null],
            ['id' => 'other', 'email' => 'other@example.test', 'name' => 'Other', 'passwordHash' => Hash::make('OriginalPass94'), 'locale' => null],
        ]);
    }

    public function test_language_negotiation_falls_back_and_explicit_choice_wins(): void
    {
        $this->getJson('/api/auth/me', ['Accept-Language' => 'xx, es-MX;q=0.9, en;q=0.5'])
            ->assertUnauthorized()->assertHeader('Content-Language', 'es')
            ->assertJsonPath('error.message', 'Inicia sesión para continuar.');
        $this->withUnencryptedCookies(['qfs_locale' => 'en'])->getJson('/api/auth/me', ['Accept-Language' => 'es'])
            ->assertUnauthorized()->assertHeader('Content-Language', 'en')
            ->assertJsonPath('error.message', 'Please log in to continue.');
        $this->withUnencryptedCookies(['qfs_locale' => 'invalid'])->getJson('/api/auth/me', ['Accept-Language' => 'xx'])
            ->assertUnauthorized()->assertHeader('Content-Language', 'en')
            ->assertJsonPath('error.message', 'Please log in to continue.');
    }

    public function test_all_published_languages_localize_validation_recovery_and_print_direction(): void
    {
        $this->assertCount(21, SetLanguage::available());
        $snapshot = ['from' => '2026-10-01', 'to' => '2026-10-16', 'generatedAt' => '2026-10-16T12:00:00Z',
            'name' => 'PRIVATE_NAME_94', 'email' => 'private@example.test', 'balanceCents' => 123456,
            'availableCents' => 123456, 'holdings' => [], 'investments' => [], 'transactions' => [], 'transactionCount' => 0];
        foreach (SetLanguage::available() as $locale) {
            $response = $this->withUnencryptedCookie('qfs_locale', $locale)->postJson('/api/auth/locale', []);
            $response->assertStatus(400)->assertHeader('Content-Language', $locale);
            $this->assertNotEmpty($response->json('error.message'));
            if ($locale !== 'en') {
                $this->assertStringNotContainsString('field is required', $response->json('error.message'));
            }
            $html = (new PasswordRecoveryMail('PRIVATE_NAME_94', 'https://qfs.test/reset-password#token=private'))->locale($locale)->render();
            $this->assertStringContainsString('lang="'.$locale.'"', $html);
            $this->assertStringContainsString('dir="'.(in_array($locale, ['ar', 'ur'], true) ? 'rtl' : 'ltr').'"', $html);
            $this->assertStringContainsString('PRIVATE_NAME_94', $html);
            $this->assertStringContainsString('https://qfs.test/reset-password#token=private', $html);
            app()->setLocale($locale);
            $print = view('statements.account', ['statement' => $snapshot])->render();
            $this->assertStringContainsString('dir="'.(in_array($locale, ['ar', 'ur'], true) ? 'rtl' : 'ltr').'"', $print);
            $this->assertStringContainsString('PRIVATE_NAME_94', $print);
            $message = LocalizedText::translate('Credited {amount, number, ::currency/USD} to your balance — {note}.', ['amount' => 1234.56, 'note' => 'PRIVATE_NOTE_94']);
            $this->assertStringContainsString('PRIVATE_NOTE_94', $message);
            $this->assertStringNotContainsString('{amount', $message);
        }
    }

    public function test_preference_updates_only_the_authenticated_account(): void
    {
        $this->withUnencryptedCookies(['qfs_session' => SessionAuth::issue('investor')])
            ->postJson('/api/auth/locale', ['locale' => 'es'])->assertOk()->assertJsonPath('data.locale', 'es');
        $this->assertSame('es', DB::table('User')->where('id', 'investor')->value('locale'));
        $this->assertNull(DB::table('User')->where('id', 'other')->value('locale'));
        $this->assertSame('USER', DB::table('User')->where('id', 'investor')->value('role'));
        $this->postJson('/api/auth/locale', ['locale' => 'unsupported'])->assertStatus(400);
        $this->assertSame('es', DB::table('User')->where('id', 'investor')->value('locale'));
        $this->withUnencryptedCookies(['qfs_session' => ''])->postJson('/api/auth/locale', ['locale' => 'es'])->assertUnauthorized();
        $this->assertSame('es', DB::table('User')->where('id', 'investor')->value('locale'));
    }

    public function test_login_restores_saved_preference_without_overriding_an_explicit_choice(): void
    {
        DB::table('User')->where('id', 'investor')->update(['locale' => 'es']);
        $this->postJson('/api/auth/login', ['email' => 'investor@example.test', 'password' => 'OriginalPass94'])
            ->assertOk()->assertPlainCookie('qfs_locale', 'es');
        $this->withUnencryptedCookies(['qfs_locale' => 'fr'])
            ->postJson('/api/auth/login', ['email' => 'investor@example.test', 'password' => 'OriginalPass94'])
            ->assertOk()->assertCookieMissing('qfs_locale');
    }

    public function test_localization_preserves_names_and_currency_values(): void
    {
        app()->setLocale('es');
        $this->assertSame('Idioma', LocalizedText::translate('Language'));
        $this->assertSame('Hola, María:', LocalizedText::translate('Hello {name},', ['name' => 'María']));
        $this->assertSame('custom investor note', LocalizedText::translate('custom investor note'));
        $formatted = Qfs::money(123456);
        $this->assertStringContainsString('1.234,56', $formatted);
        $this->assertStringContainsString('$', $formatted);
        $this->assertStringContainsString('0,1302', Qfs::money(13.02, 4));
        app()->setLocale('en');
        $this->assertSame('$1,234.56', Qfs::money(123456));
    }

    public function test_published_languages_translate_validation_and_private_recovery_email(): void
    {
        foreach ([
            'fr' => ['Le champ Langue est obligatoire.', 'Bonjour María,', 'Réinitialiser le mot de passe', 'ltr'],
            'ar' => ['الحقل اللغة مطلوب.', 'مرحبًا María،', 'إعادة تعيين كلمة المرور', 'rtl'],
            'de' => ['Das Feld Sprache ist erforderlich.', 'Hallo María,', 'Passwort zurücksetzen', 'ltr'],
        ] as $locale => [$validation, $greeting, $button, $direction]) {
            $this->withUnencryptedCookie('qfs_locale', $locale)->postJson('/api/auth/locale', [])
                ->assertStatus(400)->assertHeader('Content-Language', $locale)
                ->assertJsonPath('error.code', 'BAD_REQUEST')->assertJsonPath('error.message', $validation);
            $html = (new PasswordRecoveryMail('María', 'https://qfs.test/reset-password#token=private'))->locale($locale)->render();
            $this->assertStringContainsString('lang="'.$locale.'" dir="'.$direction.'"', $html);
            $this->assertStringContainsString($greeting, $html);
            $this->assertStringContainsString($button, $html);
            $this->assertStringContainsString('https://qfs.test/reset-password#token=private', $html);
        }
        $this->assertNull(DB::table('User')->where('id', 'investor')->value('locale'));
    }

    public function test_email_uses_the_selected_language_and_keeps_the_private_link(): void
    {
        $mail = (new PasswordRecoveryMail('María', 'https://qfs.test/reset-password#token=secret'))->locale('es');
        $html = $mail->render();
        $this->assertStringContainsString('lang="es"', $html);
        $this->assertStringContainsString('Hola, María:', $html);
        $this->assertStringContainsString('Restablecer contraseña', $html);
        $this->assertStringContainsString('https://qfs.test/reset-password#token=secret', $html);
        $this->assertStringContainsString('30 minutos', $html);
        $this->assertSame('en', app()->getLocale());
    }

    public function test_notification_language_changes_without_rewriting_amounts_or_private_notes(): void
    {
        $source = 'Credited {amount, number, ::currency/USD} to your balance — {note}.';
        app()->setLocale('es');
        AdminLog::notify('investor', 'Profit credited', $source, ['amount' => 1234.56, 'note' => 'Private note: María']);
        AdminLog::notify('other', 'Private message', 'Other investor information');
        $stored = DB::table('Notification')->where('userId', 'investor')->first();
        $this->assertStringContainsString('$1,234.56', $stored->body);
        $this->assertSame(1234.56, json_decode($stored->messageParams, true)['values']['amount']);
        $this->withUnencryptedCookies(['qfs_session' => SessionAuth::issue('investor'), 'qfs_locale' => 'es'])
            ->getJson('/api/notifications')->assertOk()->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.body', 'Se han abonado 1234,56 US$ a tu saldo — Private note: María.');
        $this->withUnencryptedCookie('qfs_locale', 'en')->getJson('/api/notifications')
            ->assertOk()->assertJsonPath('data.items.0.body', $stored->body);
        $this->assertSame($stored->body, DB::table('Notification')->where('id', $stored->id)->value('body'));
    }

    public function test_transaction_labels_translate_without_changing_ledger_fields_or_ownership(): void
    {
        Schema::create('Transaction', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('userId');
            $table->string('type');
            $table->integer('amountCents');
            $table->string('status');
            $table->string('method')->nullable();
            $table->string('note')->nullable();
            $table->string('reference');
            $table->timestamp('createdAt')->useCurrent();
        });
        DB::table('Transaction')->insert([
            ['id' => 'own', 'userId' => 'investor', 'type' => 'DEPOSIT', 'amountCents' => 123456, 'status' => 'COMPLETED', 'method' => 'Bank Transfer', 'note' => 'Private note: María', 'reference' => 'INVESTOR-REF'],
            ['id' => 'private', 'userId' => 'other', 'type' => 'DEPOSIT', 'amountCents' => 9999, 'status' => 'COMPLETED', 'method' => 'Bank Transfer', 'note' => 'Other private note', 'reference' => 'OTHER-REF'],
        ]);
        $this->withUnencryptedCookies(['qfs_session' => SessionAuth::issue('investor'), 'qfs_locale' => 'ar'])
            ->getJson('/api/transactions')->assertOk()->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.label', 'إيداع')
            ->assertJsonPath('data.items.0.type', 'DEPOSIT')
            ->assertJsonPath('data.items.0.amountCents', 123456)
            ->assertJsonPath('data.items.0.status', 'COMPLETED')
            ->assertJsonPath('data.items.0.reference', 'INVESTOR-REF')
            ->assertJsonPath('data.items.0.note', 'Private note: María');
        $this->assertSame(123456, DB::table('Transaction')->where('id', 'own')->value('amountCents'));
    }

    public function test_invalid_input_uses_native_translated_validation_and_preserves_error_code(): void
    {
        $this->withUnencryptedCookie('qfs_locale', 'es')->postJson('/api/auth/locale', [])
            ->assertStatus(400)->assertJsonPath('error.code', 'BAD_REQUEST')
            ->assertJsonPath('error.message', 'El campo Idioma es obligatorio.');
        $this->postJson('/api/auth/locale', ['locale' => 'unsupported'])
            ->assertStatus(400)->assertJsonPath('error.message', 'El valor seleccionado para Idioma no es válido.');
        $this->assertNull(DB::table('User')->where('id', 'investor')->value('locale'));
    }
}
