<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;

final class Search
{
    public static function pattern(string $term): string
    {
        return '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($term)).'%';
    }

    public static function match(Builder $query, string $column, string $pattern, string $boolean = 'and'): Builder
    {
        return $query->whereRaw('LOWER('.$query->getGrammar()->wrap($column).") LIKE ? ESCAPE '!'", [$pattern], $boolean);
    }
}
