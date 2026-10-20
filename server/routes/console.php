<?php

use App\Support\Earnings;
use App\Support\ReferralRewards;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(fn () => Earnings::sweep())
    ->name('investment-earnings')
    ->hourly()
    ->withoutOverlapping();

Schedule::command('swaps:reconcile')->everyMinute()->withoutOverlapping();

Schedule::command('queue:work database --queue=mail --stop-when-empty --max-time=50 --timeout=25 --tries=5')
    ->everyMinute()->withoutOverlapping(2);

Schedule::call(fn () => ReferralRewards::sweep())
    ->name('deposit-referral-rewards')->everyMinute()->withoutOverlapping();
