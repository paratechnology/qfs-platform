<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class AdminLog
{
    public static function audit(string $actorId, string $action, string $targetType, ?string $targetId, array $meta = []): void
    {
        DB::table('AuditLog')->insert([
            'id' => Qfs::id(), 'actorId' => $actorId, 'actorRole' => 'ADMIN',
            'action' => $action, 'targetType' => $targetType, 'targetId' => $targetId,
            'meta' => $meta ? json_encode($meta) : null,
        ]);
    }

    public static function notify(string $userId, string $title, ?string $body = null, array $values = []): void
    {
        $row = [
            'id' => Qfs::id(), 'userId' => $userId, 'title' => $title, 'body' => $body,
        ];
        if ($values !== [] && $body !== null) {
            $row['messageParams'] = json_encode(['source' => $body, 'values' => $values], JSON_UNESCAPED_UNICODE);
            $formatted = \MessageFormatter::formatMessage('en', $body, $values);
            $row['body'] = $formatted === false ? $body : $formatted;
        }
        DB::table('Notification')->insert($row);
        AccountEmail::queueNotification($row);
    }
}
