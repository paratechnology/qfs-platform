<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\BigInteger;
use Brick\Math\RoundingMode;

final class CryptoAssets
{
    public const ALL = [
        'BTC' => ['symbol' => 'BTC', 'name' => 'Bitcoin', 'network' => 'Bitcoin', 'chain' => 'bitcoin', 'decimals' => 8, 'priceId' => 'bitcoin', 'chainId' => null, 'token' => null, 'explorer' => 'https://mempool.space/tx/'],
        'ETH' => ['symbol' => 'ETH', 'name' => 'Ethereum', 'network' => 'Ethereum', 'chain' => 'ethereum', 'decimals' => 18, 'priceId' => 'ethereum', 'chainId' => 1, 'token' => null, 'explorer' => 'https://etherscan.io/tx/'],
        'USDT_TRC20' => ['symbol' => 'USDT', 'name' => 'Tether', 'network' => 'Tron (TRC20)', 'chain' => 'tron', 'decimals' => 6, 'priceId' => 'tether', 'chainId' => null, 'token' => null, 'explorer' => 'https://tronscan.org/#/transaction/'],
        'USDT_BEP20' => ['symbol' => 'USDT', 'name' => 'Tether', 'network' => 'BNB Smart Chain (BEP20)', 'chain' => 'bsc', 'decimals' => 18, 'priceId' => 'tether', 'chainId' => 56, 'token' => '0x55d398326f99059fF775485246999027B3197955', 'explorer' => 'https://bscscan.com/tx/'],
        'XRP' => ['symbol' => 'XRP', 'name' => 'XRP', 'network' => 'XRP Ledger', 'chain' => 'xrpl', 'decimals' => 6, 'priceId' => 'ripple', 'chainId' => null, 'token' => null, 'explorer' => 'https://livenet.xrpl.org/transactions/'],
        'SOL' => ['symbol' => 'SOL', 'name' => 'Solana', 'network' => 'Solana', 'chain' => 'solana', 'decimals' => 9, 'priceId' => 'solana', 'chainId' => null, 'token' => null, 'explorer' => 'https://solscan.io/tx/'],
    ];

    public static function get(string $key): array
    {
        return self::ALL[$key] ?? Guard::fail('ASSET', 'Select a supported asset and network.', 400);
    }

    public static function units(string $key, mixed $quantity): string
    {
        $asset = self::get($key);
        if (! is_string($quantity) || ! preg_match('/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/D', $quantity)) {
            Guard::fail('QUANTITY', 'Enter a crypto quantity using decimal notation.', 400);
        }
        try {
            $units = BigDecimal::of($quantity)->withPointMovedRight($asset['decimals'])->toScale(0);
        } catch (\Throwable) {
            Guard::fail('QUANTITY', 'The quantity has too many decimal places for this asset.', 400);
        }
        if ($units->isLessThanOrEqualTo(0)) {
            Guard::fail('QUANTITY', 'Quantity must be greater than zero.', 400);
        }

        return (string) $units;
    }

    public static function quantity(string $key, string $units): string
    {
        $value = (string) BigDecimal::ofUnscaledValue($units, self::get($key)['decimals']);

        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }

    public static function usd(string $key, string $units, string $rate): int
    {
        return BigDecimal::ofUnscaledValue($units, self::get($key)['decimals'])
            ->multipliedBy($rate)->multipliedBy(100)->toScale(0, RoundingMode::Down)->toInt();
    }

    public static function fromUsd(string $key, int $cents, string $rate, bool $roundUp): string
    {
        $value = BigDecimal::of($cents)->withPointMovedRight(self::get($key)['decimals'])
            ->dividedBy(BigDecimal::of($rate)->multipliedBy(100), 0, $roundUp ? RoundingMode::Ceiling : RoundingMode::Floor);
        if ($value->isLessThanOrEqualTo(0)) {
            Guard::fail('QUANTITY', 'The amount is below the smallest unit of this asset.', 400);
        }

        return (string) $value;
    }

    public static function address(string $key, string $address): string
    {
        $asset = self::get($key);
        $address = trim($address);
        if ($asset['chainId'] !== null) {
            $valid = WalletCrypto::address($address) !== null && ! preg_match('/^0x0{40}$/D', $address);
        } elseif ($asset['chain'] === 'tron') {
            $valid = self::base58Check($address, [65]);
        } elseif ($key === 'XRP') {
            $raw = self::decode58($address, 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz');
            $valid = strlen($raw) === 25 && ord($raw[0]) === 0
                && substr($raw, 1, 20) !== str_repeat("\0", 20)
                && hash_equals(substr(hash('sha256', hash('sha256', substr($raw, 0, 21), true), true), 0, 4), substr($raw, 21));
        } elseif ($key === 'SOL') {
            $raw = self::decode58($address);
            $valid = strlen($raw) === 32 && $raw !== str_repeat("\0", 32);
        } else {
            $valid = self::base58Check($address, [0, 5]) || self::bitcoinWitness($address);
        }
        if (! $valid) {
            Guard::fail('ADDRESS', 'Enter a valid receiving address for the selected network.', 400);
        }

        return $asset['chainId'] !== null ? strtolower($address) : $address;
    }

    public static function destinationTag(string $key, mixed $tag): ?string
    {
        if ($tag === null || $tag === '') {
            return null;
        }
        if ($key !== 'XRP' || ! is_string($tag) || ! preg_match('/^(0|[1-9][0-9]{0,9})$/D', $tag) || BigInteger::of($tag)->isGreaterThan('4294967295')) {
            Guard::fail('DESTINATION_TAG', 'Enter a valid XRP destination tag between 0 and 4294967295.', 400);
        }

        return $tag;
    }

    private static function decode58(string $value, string $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'): string
    {
        if ($value === '' || strlen($value) > 100) {
            return '';
        }
        $number = BigInteger::of(0);
        foreach (str_split($value) as $char) {
            $digit = strpos($alphabet, $char);
            if ($digit === false) {
                return '';
            }
            $number = $number->multipliedBy(58)->plus($digit);
        }
        $hex = $number->toBase(16);

        return str_repeat("\0", strspn($value, $alphabet[0])).($number->isZero() ? '' : hex2bin(str_pad($hex, strlen($hex) + strlen($hex) % 2, '0', STR_PAD_LEFT)));
    }

    private static function base58Check(string $address, array $versions): bool
    {
        if (! preg_match('/^[1-9A-HJ-NP-Za-km-z]{26,35}$/D', $address)) {
            return false;
        }
        $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        $value = BigInteger::of(0);
        foreach (str_split($address) as $char) {
            $value = $value->multipliedBy(58)->plus(strpos($alphabet, $char));
        }
        $hex = $value->toBase(16);
        $raw = str_repeat("\0", strspn($address, '1')).hex2bin(str_pad($hex, strlen($hex) + strlen($hex) % 2, '0', STR_PAD_LEFT));

        return strlen($raw) === 25 && in_array(ord($raw[0]), $versions, true)
            && hash_equals(substr(hash('sha256', hash('sha256', substr($raw, 0, 21), true), true), 0, 4), substr($raw, 21));
    }

    private static function bitcoinWitness(string $address): bool
    {
        if (strtolower($address) !== $address && strtoupper($address) !== $address) {
            return false;
        }
        $address = strtolower($address);
        if (! str_starts_with($address, 'bc1') || strlen($address) > 90) {
            return false;
        }
        $alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
        $data = [];
        foreach (str_split(substr($address, 3)) as $char) {
            $number = strpos($alphabet, $char);
            if ($number === false) {
                return false;
            }
            $data[] = $number;
        }
        if (count($data) < 10 || $data[0] > 16) {
            return false;
        }
        $checksum = 1;
        foreach ([3, 3, 0, 2, 3, ...$data] as $number) {
            $top = $checksum >> 25;
            $checksum = (($checksum & 0x1FFFFFF) << 5) ^ $number;
            foreach ([0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3] as $i => $generator) {
                if (($top >> $i) & 1) {
                    $checksum ^= $generator;
                }
            }
        }
        $bits = (count($data) - 7) * 5;
        $bytes = intdiv($bits, 8);
        $padding = $bits % 8;

        return $padding < 5 && ($data[count($data) - 7] & ((1 << $padding) - 1)) === 0
            && ($data[0] === 0 ? in_array($bytes, [20, 32], true) && $checksum === 1
                : $bytes >= 2 && $bytes <= 40 && $checksum === 0x2BC830A3);
    }

    public static function txKey(string $key, string $hash): string
    {
        $asset = self::get($key);
        $hash = trim($hash);
        if ($key === 'SOL') {
            if (strlen(self::decode58($hash)) !== 64) {
                Guard::fail('TRANSACTION', 'Enter a valid transaction hash for this network.', 400);
            }

            return $asset['chain'].':'.$hash;
        }
        $hash = strtolower($hash);
        $pattern = $asset['chainId'] !== null ? '/^0x[a-f0-9]{64}$/D' : '/^[a-f0-9]{64}$/D';
        if (! preg_match($pattern, $hash)) {
            Guard::fail('TRANSACTION', 'Enter a valid transaction hash for this network.', 400);
        }

        return $asset['chain'].':'.$hash;
    }

    public static function hash(string $key, string $hash): string
    {
        return explode(':', self::txKey($key, $hash), 2)[1];
    }
}
