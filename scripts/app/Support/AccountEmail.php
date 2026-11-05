<?php

namespace App\Support;

use App\Jobs\SendAccountEmail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

final class AccountEmail
{
    public static function deliveryAvailable(?string $mailer = null, array $visited = []): bool
    {
        $mailer ??= (string) config('mail.default');
        if (in_array($mailer, $visited, true)) {
            return false;
        }
        $settings = config('mail.mailers.'.$mailer, []);
        $transport = $settings['transport'] ?? null;
        if (in_array($transport, ['log', 'array'], true)) {
            return app()->environment('testing') && $transport === 'array';
        }
        if (in_array($transport, ['failover', 'roundrobin'], true)) {
            $children = $settings['mailers'] ?? [];
            if (! $children) {
                return false;
            }
            foreach ($children as $child) {
                if (! self::deliveryAvailable($child, [...$visited, $mailer])) {
                    return false;
                }
            }
        }
        if ($transport === 'smtp') {
            if (! empty($settings['url'])) {
                return true;
            }
            if (empty($settings['host'])) {
                return false;
            }
            if (! empty($settings['username']) && ! empty($settings['password'])) {
                return true;
            }

            return app()->environment('local');
        }

        return is_string($transport) && $transport !== '';
    }

    public static function shouldEmailNotification(string $title): bool
    {
        // Hourly accrual jobs would spam inboxes; everything else mirrors in-app notifications.
        return strcasecmp($title, 'Investment profit credited') !== 0;
    }

    public static function queueNotification(array $notification): void
    {
        $title = $notification['title'];
        if (! MailSettings::accountEmailsEnabled() || ! self::deliveryAvailable() || ! self::shouldEmailNotification($title)) {
            return;
        }
        DB::afterCommit(function () use ($notification): void {
            try {
                SendAccountEmail::dispatch($notification['id']);
            } catch (Throwable $error) {
                // Email infrastructure must never turn a committed approval into an error.
                Log::error('Account email could not be queued.', ['notificationId' => $notification['id'], 'exception' => get_class($error)]);
            }
        });
    }

    public static function actionUrl(string $title): string
    {
        $path = match (true) {
            $title === 'Account registration successful.' => '/user/user/login',
            str_starts_with(strtolower($title), 'wallet review ') => '/user/user/connect',
            str_starts_with(strtolower($title), 'withdrawal ') => '/user/user/dashboard/withdrawals',
            str_starts_with(strtolower($title), 'loan ') => '/user/user/dashboard/loans',
            str_contains(strtolower($title), 'verification') => '/user/user/dashboard/verification',
            str_starts_with(strtolower($title), 'deposit ') => '/user/user/dashboard/transactions',
            default => '/user/user/dashboard',
        };

        return rtrim((string) config('qfs.public_url'), '/').$path;
    }
}
