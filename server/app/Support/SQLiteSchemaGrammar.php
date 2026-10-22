<?php

namespace App\Support;

use Illuminate\Database\Query\Expression;
use Illuminate\Database\Schema\Grammars\SQLiteGrammar;

final class SQLiteSchemaGrammar extends SQLiteGrammar
{
    /** Quote introspected foreign tables, including reserved identifiers, during rebuilds. */
    protected function getForeignKey($foreign): string
    {
        if ($foreign->on instanceof Expression) {
            $foreign = clone $foreign;
            $foreign->on = $this->getValue($foreign->on);
        }

        return parent::getForeignKey($foreign);
    }
}
