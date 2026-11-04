<?php

namespace App\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

final class Reviews
{
    public const VISIBLE_STATUS = 'APPROVED';

    /** The original class-project examples remain explicitly labelled and never enter the review table. */
    public static function published(int $limit = 50): Collection
    {
        if (! config('qfs.illustrative_reviews', false)) {
            return self::visible($limit);
        }
        $samples = json_decode(file_get_contents(resource_path('data/illustrative-reviews.json')), true, 512, JSON_THROW_ON_ERROR);

        return collect($samples)->take($limit)->map(fn ($sample, $index) => (object) [
            'id' => 'illustrative-'.$index, 'userName' => $sample['name'], 'country' => '',
            'avatarUrl' => '', 'imageUrl' => '', 'rating' => $sample['stars'], 'text' => $sample['text'], 'status' => 'ILLUSTRATIVE',
        ]);
    }

    /** @return Collection<int, object> */
    public static function visible(int $limit = 20): Collection
    {
        return DB::table('Review')
            ->where('status', self::VISIBLE_STATUS)
            ->orderBy('sort')
            ->limit($limit)
            ->get();
    }

    public static function photoUrl(object $review): string
    {
        $url = trim((string) ($review->imageUrl ?? ''));
        if ($url === '') {
            $url = trim((string) ($review->avatarUrl ?? ''));
        }

        return $url !== '' ? $url : '/avatars/avatar1.jpg';
    }

    /** @return list<array{name: string, meta: string, avatar: string, image: string, stars: int, text: string}> */
    public static function forOverview(int $limit = 20): array
    {
        return self::published($limit)->map(function ($review) {
            $photo = $review->status === 'ILLUSTRATIVE' ? '' : self::photoUrl($review);

            return [
                'name' => $review->userName,
                'meta' => $review->status === 'ILLUSTRATIVE' ? '' : ($review->country ? $review->country.' · ' : '').LocalizedText::translate('Verified Investor'),
                'avatar' => $photo,
                'image' => $photo,
                'stars' => (int) $review->rating,
                'text' => $review->text,
            ];
        })->all();
    }

    /** @return array<int, int> */
    public static function ratingCounts(): array
    {
        $counts = [5 => 0, 4 => 0, 3 => 0, 2 => 0, 1 => 0];
        if (config('qfs.illustrative_reviews', false)) {
            foreach (self::published() as $review) {
                $counts[$review->rating]++;
            }

            return $counts;
        }
        foreach (DB::table('Review')->where('status', self::VISIBLE_STATUS)
            ->selectRaw('rating, COUNT(*) as total')->groupBy('rating')->get() as $row) {
            $star = max(1, min(5, (int) $row->rating));
            $counts[$star] += (int) $row->total;
        }

        return $counts;
    }

    /**
     * Integer star shares that always sum to 100 when any reviews exist.
     *
     * @param  array<int, int>  $counts
     * @return array<int, int>
     */
    public static function sharePercents(array $counts): array
    {
        $total = array_sum($counts);
        $shares = [];
        foreach ($counts as $star => $_) {
            $shares[(int) $star] = 0;
        }
        if ($total <= 0) {
            return $shares;
        }

        $remainders = [];
        $used = 0;
        foreach ($counts as $star => $count) {
            $exact = ((int) $count) * 100 / $total;
            $floor = (int) floor($exact);
            $shares[(int) $star] = $floor;
            $remainders[(int) $star] = $exact - $floor;
            $used += $floor;
        }

        $left = 100 - $used;
        arsort($remainders, SORT_NUMERIC);
        foreach (array_keys($remainders) as $star) {
            if ($left <= 0) {
                break;
            }
            if (($counts[$star] ?? 0) === 0) {
                continue;
            }
            $shares[$star]++;
            $left--;
        }

        return $shares;
    }

    /** Weighted score as a percent of 5 stars: (sum of ratings) / (reviews × 5) × 100. */
    public static function scorePercent(array $counts): float
    {
        $total = array_sum($counts);
        if ($total <= 0) {
            return 0.0;
        }
        $weighted = 0;
        foreach ($counts as $star => $count) {
            $weighted += ((int) $star) * ((int) $count);
        }

        return round($weighted / ($total * 5) * 100, 1);
    }

    /** @return array{total: int, average: float, scorePercent: float, stars: list<array{stars: int, count: int, percent: int}>} */
    public static function ratingSummary(): array
    {
        $counts = self::ratingCounts();
        $total = array_sum($counts);
        $percents = self::sharePercents($counts);
        $weighted = 0;
        foreach ($counts as $star => $count) {
            $weighted += $star * $count;
        }

        $stars = [];
        foreach ([5, 4, 3, 2, 1] as $star) {
            $stars[] = [
                'stars' => $star,
                'count' => $counts[$star],
                'percent' => $percents[$star],
            ];
        }

        return [
            'total' => $total,
            'average' => $total ? round($weighted / $total, 2) : 0.0,
            'scorePercent' => self::scorePercent($counts),
            'stars' => $stars,
        ];
    }
}
