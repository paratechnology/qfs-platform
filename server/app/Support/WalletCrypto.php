<?php

namespace App\Support;

use Elliptic\EC;
use kornrunner\Keccak;

final class WalletCrypto
{
    public static function address(string $input): ?string
    {
        if (!preg_match('/^0x[0-9a-fA-F]{40}$/', $input)) return null;
        $lower = strtolower(substr($input, 2));
        $hash = Keccak::hash($lower, 256);
        $checksummed = '0x';
        for ($i = 0; $i < 40; $i++) {
            $checksummed .= hexdec($hash[$i]) >= 8 ? strtoupper($lower[$i]) : $lower[$i];
        }
        $body = substr($input, 2);
        if ($body !== strtolower($body) && $body !== strtoupper($body) && $input !== $checksummed) return null;
        return $checksummed;
    }

    public static function recoveredAddress(string $message, string $signature): ?string
    {
        if (!preg_match('/^0x[0-9a-fA-F]{130}$/', $signature)) return null;
        $v = hexdec(substr($signature, 130, 2));
        $recovery = $v >= 27 ? $v - 27 : $v;
        if ($recovery !== 0 && $recovery !== 1) return null;
        try {
            $hash = Keccak::hash("\x19Ethereum Signed Message:\n".strlen($message).$message, 256);
            $public = (new EC('secp256k1'))->recoverPubKey($hash, [
                'r' => substr($signature, 2, 64),
                's' => substr($signature, 66, 64),
            ], $recovery);
            $bytes = hex2bin($public->encode('hex', false));
            if ($bytes === false || strlen($bytes) !== 65 || $bytes[0] !== "\x04") return null;
            return self::address('0x'.substr(Keccak::hash(substr($bytes, 1), 256), -40));
        } catch (\Throwable) {
            return null;
        }
    }
}
