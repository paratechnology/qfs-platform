<!doctype html>
@php($text = fn ($source, $values = []) => \App\Support\LocalizedText::translate($source, $values))
<html lang="{{ app()->getLocale() }}" dir="{{ in_array(app()->getLocale(), ['ar', 'ur']) ? 'rtl' : 'ltr' }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ $text('QFS account recovery') }}</title></head>
<body style="margin:0;background:#f4f4f6;font-family:Arial,sans-serif;color:#202027;line-height:1.6">
<div style="max-width:520px;margin:40px auto;padding:32px;background:#fff;border-radius:16px">
<strong style="font-size:20px">QFS</strong>
<h1 style="font-size:24px;line-height:1.3">{{ $text($resetUrl ? 'Reset your password' : 'Password changed') }}</h1>
<p>{{ $text('Hello {name},', ['name' => $name]) }}</p>
@if ($resetUrl)
<p>{{ $text('We received a request to reset your account password. This private link expires in 30 minutes and can be used once.') }}</p>
<p style="margin:28px 0"><a href="{{ $resetUrl }}" style="display:inline-block;padding:12px 22px;border-radius:9px;background:#992c92;color:#fff;text-decoration:none;font-weight:bold">{{ $text('Reset password') }}</a></p>
<p>{{ $text('If you did not request this, you can ignore this email. Your password has not changed.') }}</p>
<p style="font-size:12px;color:#666">{{ $text('If the button does not work, copy this link into your browser:') }}<br><a href="{{ $resetUrl }}" style="color:#992c92;overflow-wrap:anywhere">{{ $resetUrl }}</a></p>
@else
<p>{{ $text('Your account password was changed. Existing sessions have been signed out.') }}</p>
<p>{{ $text('If you did not make this change, contact QFS support immediately.') }}</p>
@endif
<p style="font-size:12px;color:#666">{{ $text('Keep recovery links private. QFS will never ask for your wallet seed phrase or private key.') }}</p>
<p><a href="mailto:{{ config('qfs.support_email') }}" style="color:#992c92">{{ $text('Contact support for more information') }}</a></p>
</div></body></html>
