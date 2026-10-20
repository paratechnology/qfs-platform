<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class PlanMaterials
{
    public static function forPlan(object $plan): array
    {
        $ids = json_decode($plan->documentIds ?? '[]', true) ?: [];
        $documents = $ids ? DB::table('Document')->whereIn('id', $ids)->where('isActive', true)->get()
            ->map(fn ($document) => ['id' => $document->id, 'title' => $document->title, 'fileUrl' => $document->fileUrl])->all() : [];

        $materials = ['description' => $plan->description ?? null, 'terms' => $plan->terms ?? null,
            'riskDisclosure' => $plan->riskDisclosure ?? null, 'documents' => $documents,
            'materialsCapturedAt' => $plan->updatedAt ?? null];
        $translations = json_decode($plan->translations ?? '{}', true) ?: [];
        if ($translations) {
            $materials['translations'] = $translations;
        }

        return $materials;
    }

    public static function sourceHash(array $materials): string
    {
        return hash('sha256', implode("\0", array_map(fn ($key) => $materials[$key] ?? '', ['description', 'terms', 'riskDisclosure'])));
    }

    public static function localize(array $materials): array
    {
        $locale = app()->getLocale();
        $version = $materials['translations'][$locale] ?? null;
        unset($materials['translations']);
        if (! is_array($version) || ($version['sourceHash'] ?? '') !== self::sourceHash($materials)) {
            return [...$materials, 'contentLanguage' => 'en'];
        }
        $original = array_intersect_key($materials, array_flip(['description', 'terms', 'riskDisclosure']));
        foreach (['description', 'terms', 'riskDisclosure'] as $key) {
            if (! empty($version[$key])) {
                $materials[$key] = $version[$key];
            }
        }

        return [...$materials, 'contentLanguage' => $locale, 'originalMaterials' => $original];
    }

    public static function snapshot(object $plan): string
    {
        return json_encode([...self::forPlan($plan), 'materialsCapturedAt' => now('UTC')->toIso8601String()], JSON_UNESCAPED_SLASHES);
    }
}
