<?php

namespace App\Jobs;

use App\Mail\AccountUpdateMail;
use App\Support\AccountEmail;
use App\Support\LocalizedText;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class SendAccountEmail implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 25;

    public function __construct(public string $notificationId)
    {
        $this->onConnection('database')->onQueue('mail')->afterCommit();
    }

    public function backoff(): array
    {
        return [60, 300, 900, 1800];
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        $notification = DB::table('Notification')->where('id', $this->notificationId)->first();
        $user = $notification ? DB::table('User')->where('id', $notification->userId)->first() : null;
        if (! $user || $user->status !== 'ACTIVE' || ! config('qfs.account_emails')) {
            return;
        }
        if (! AccountEmail::deliveryAvailable()) {
            throw new \RuntimeException('Outbound email is not configured.');
        }
        $previousLocale = app()->getLocale();
        try {
            app()->setLocale($user->locale ?? 'en');
            $text = LocalizedText::notification($notification);
        } finally {
            app()->setLocale($previousLocale);
        }
        Mail::to($user->email)->send((new AccountUpdateMail($user->name, $text['title'], $text['body'], AccountEmail::actionUrl($notification->title)))->locale($user->locale ?? 'en'));
    }
}
