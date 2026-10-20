<?php

namespace App\Support;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class TwoFactor
{
    public static function generateSecret(): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split(random_bytes(20)) as $byte) {
            $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
        }
        $secret = '';
        foreach (str_split($bits, 5) as $part) {
            $secret .= $alphabet[bindec($part)];
        }

        return $secret;
    }

    /** RFC 4226 / RFC 6238, SHA-1, six digits and 30-second steps. */
    public static function code(string $secret, int $counter): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split($secret) as $char) {
            $position = strpos($alphabet, $char);
            if ($position === false) {
                throw new \InvalidArgumentException('Invalid authenticator secret');
            }
            $bits .= str_pad(decbin($position), 5, '0', STR_PAD_LEFT);
        }
        $key = '';
        foreach (str_split($bits, 8) as $part) {
            if (strlen($part) === 8) {
                $key .= chr(bindec($part));
            }
        }
        $hash = hash_hmac('sha1', pack('N2', intdiv($counter, 4294967296), $counter % 4294967296), $key, true);
        $offset = ord($hash[19]) & 15;
        $value = unpack('N', substr($hash, $offset, 4))[1] & 0x7FFFFFFF;

        return str_pad((string) ($value % 1000000), 6, '0', STR_PAD_LEFT);
    }

    public static function counter(string $secret, string $code, int $lastCounter = -1): ?int
    {
        if (! preg_match('/^\d{6}$/D', $code)) {
            return null;
        }
        $current = intdiv(now()->timestamp, 30);
        foreach ([$current, $current - 1, $current + 1] as $counter) {
            if ($counter > $lastCounter && hash_equals(self::code($secret, $counter), $code)) {
                return $counter;
            }
        }

        return null;
    }

    /** Caller holds the AccountSecurity row lock; successful proofs are consumed. */
    public static function verify(object $security, string $proof): bool
    {
        if (! $security->enabledAt || ! $security->secret) {
            return false;
        }
        $counter = self::counter(Crypt::decryptString($security->secret), $proof, (int) $security->lastCounter);
        if ($counter !== null) {
            DB::table('AccountSecurity')->where('userId', $security->userId)->update(['lastCounter' => $counter]);

            return true;
        }
        $hashes = json_decode($security->recoveryHashes ?? '[]', true);
        $hash = hash('sha256', strtoupper(str_replace('-', '', trim($proof))));
        foreach ($hashes as $index => $stored) {
            if (hash_equals($stored, $hash)) {
                unset($hashes[$index]);
                DB::table('AccountSecurity')->where('userId', $security->userId)->update(['recoveryHashes' => json_encode(array_values($hashes))]);

                return true;
            }
        }

        return false;
    }

    public static function recoveryCodes(): array
    {
        return array_map(fn () => strtoupper(implode('-', str_split(bin2hex(random_bytes(10)), 5))), range(1, 10));
    }

    public static function recoveryHashes(array $codes): string
    {
        return json_encode(array_map(fn ($code) => hash('sha256', str_replace('-', '', $code)), $codes));
    }
}
