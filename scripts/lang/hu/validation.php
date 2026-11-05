<?php

return array_replace_recursive(require __DIR__.'/../en/validation.php', [
    'required' => 'A(z) :attribute mező kitöltése kötelező.',
    'email' => 'A(z) :attribute mezőben érvényes e-mail-címet adj meg.',
    'string' => 'A(z) :attribute mező értéke szöveg legyen.',
    'numeric' => 'A(z) :attribute mező értéke szám legyen.',
    'confirmed' => 'A(z) :attribute megerősítése nem egyezik.',
    'unique' => 'A(z) :attribute érték már használatban van.',
    'exists' => 'A kiválasztott :attribute érvénytelen.',
    'in' => 'A kiválasztott :attribute érvénytelen.',
    'accepted' => 'A(z) :attribute elfogadása kötelező.',
    'min' => ['string' => 'A(z) :attribute legalább :min karakter legyen.', 'numeric' => 'A(z) :attribute értéke legalább :min legyen.'],
    'max' => ['string' => 'A(z) :attribute legfeljebb :max karakter lehet.', 'numeric' => 'A(z) :attribute értéke legfeljebb :max lehet.'],
    'gt' => ['numeric' => 'A(z) :attribute értéke nagyobb legyen mint :value.'],
]);
