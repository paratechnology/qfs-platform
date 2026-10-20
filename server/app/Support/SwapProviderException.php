<?php

namespace App\Support;

final class SwapProviderException extends \RuntimeException
{
    public function __construct(public readonly bool $definitive = false)
    {
        parent::__construct('The exchange provider is unavailable. Please try again shortly.');
    }
}
