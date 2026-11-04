<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class PlatformFeatures
{
    public static function cryptoWithdrawalsEnabled(): bool
    {
        if (! (bool) config('qfs.crypto_withdrawals_enabled', true)) {
            return false;
        }
        if (! Schema::hasTable('Setting')) {
            return true;
        }
        $value = DB::table('Setting')->where('key', 'crypto_withdrawals_enabled')->value('value');
        if ($value === null || $value === '') {
            return true;
        }

        return MailSettings::truthy((string) $value);
    }

    public static function cryptoSwapsAvailable(): bool
    {
        return true;
    }
}
