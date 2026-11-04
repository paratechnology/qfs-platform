<?php

namespace App\Console\Commands;

use App\Support\CryptoSwaps;
use App\Support\SwapProvider;
use App\Support\SwapTreasury;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

final class ReconcileSwaps extends Command
{
    protected $signature = 'swaps:reconcile';

    protected $description = 'Reconcile pending provider swaps and treasury transfers without duplicating payments';

    public function handle(): int
    {
        if (! SwapProvider::configured()) {
            $this->info('Swap provider credentials are not configured.');

            return self::SUCCESS;
        }
        $processed = 0;
        $rows = DB::table('CryptoSwap')->whereNotIn('status', CryptoSwaps::TERMINAL)->orderBy('lastCheckedAt')->limit(100)->get();
        foreach ($rows as $row) {
            $lock = Cache::lock('swap-reconcile-'.$row->id, 120);
            if (! $lock->get()) {
                continue;
            }
            try {
                if ($row->status === 'CREATING') {
                    CryptoSwaps::create($row->id);
                } elseif ($row->status === 'OPENING' && now()->subMinutes(2)->greaterThan($row->updatedAt)) {
                    CryptoSwaps::attention($row->id, 'Order creation needs reconciliation. Do not create or fund a replacement order.');
                }
                CryptoSwaps::sync($row->id);
                SwapTreasury::tick($row->id);
                $processed++;
            } catch (\Throwable) {
                CryptoSwaps::attention($row->id, 'This swap needs reconciliation. Funds remain reserved.');
            } finally {
                $lock->release();
            }
        }
        $this->info('Reconciled '.$processed.' swaps.');

        return self::SUCCESS;
    }
}
