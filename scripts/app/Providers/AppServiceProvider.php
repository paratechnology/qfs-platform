<?php

namespace App\Providers;

use App\Support\EnvSettings;
use App\Support\LocaleHtml;
use App\Support\LocalizedText;
use App\Support\MailSettings;
use App\Support\SQLiteConnection;
use App\Support\SQLiteSchemaGrammar;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\View;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        Connection::resolverFor('sqlite', function ($pdo, $database, $prefix, $config) {
            $connection = new SQLiteConnection($pdo, $database, $prefix, $config);
            $connection->setSchemaGrammar(new SQLiteSchemaGrammar($connection));

            return $connection;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        EnvSettings::bootstrap();
        MailSettings::applyFromDatabase();

        View::share('tx', fn (?string $source, array $values = []) => LocalizedText::translate($source, $values));
        View::composer('*', function ($view): void {
            $view->with([
                'htmlLang' => LocaleHtml::lang(),
                'htmlDir' => LocaleHtml::dir(),
                'localeLanguages' => LocaleHtml::languages(),
            ]);
        });

        Blade::directive('t', function (string $expression) {
            return "<?php echo e(\App\Support\LocalizedText::translate($expression)); ?>";
        });
    }
}
