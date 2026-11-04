<?php

namespace App\Support;

final class UiStrings
{
    /** @param  list<string>  $sources */
    public static function map(array $sources): array
    {
        $out = [];
        foreach ($sources as $source) {
            $out[$source] = LocalizedText::translate($source);
        }

        return $out;
    }
}
