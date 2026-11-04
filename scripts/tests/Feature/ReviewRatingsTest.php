<?php

namespace Tests\Feature;

use App\Support\Reviews;
use Tests\TestCase;

class ReviewRatingsTest extends TestCase
{
    public function test_star_shares_sum_to_one_hundred_with_largest_remainder(): void
    {
        $this->assertSame(
            [5 => 34, 4 => 33, 3 => 33, 2 => 0, 1 => 0],
            Reviews::sharePercents([5 => 1, 4 => 1, 3 => 1, 2 => 0, 1 => 0])
        );
    }

    public function test_unanimous_ratings_are_one_hundred_percent(): void
    {
        $this->assertSame(
            [5 => 100, 4 => 0, 3 => 0, 2 => 0, 1 => 0],
            Reviews::sharePercents([5 => 7, 4 => 0, 3 => 0, 2 => 0, 1 => 0])
        );
    }

    public function test_score_percent_is_weighted_average_of_five_stars(): void
    {
        $this->assertSame(80.0, Reviews::scorePercent([5 => 1, 4 => 1, 3 => 1, 2 => 0, 1 => 0]));
        $this->assertSame(0.0, Reviews::scorePercent([5 => 0, 4 => 0, 3 => 0, 2 => 0, 1 => 0]));
        $this->assertSame(100.0, Reviews::scorePercent([5 => 4, 4 => 0, 3 => 0, 2 => 0, 1 => 0]));
    }
}
