<!doctype html>
@php($text = fn ($source, $values = []) => \App\Support\LocalizedText::translate($source, $values))
<html lang="{{ app()->getLocale() }}" dir="{{ in_array(app()->getLocale(), ['ar', 'ur']) ? 'rtl' : 'ltr' }}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ $title }}</title></head>
<body style="margin:0;background:#f4f4f6;font-family:Arial,sans-serif;color:#202027;line-height:1.6">
<div style="max-width:520px;margin:40px auto;padding:32px;background:#fff;border-radius:16px">
<strong style="font-size:20px">QFS</strong>
<h1 style="font-size:24px;line-height:1.3">{{ $title }}</h1>
<p>{{ $text('Hello {name},', ['name' => $name]) }}</p>
<p style="white-space:pre-line">{{ $body }}</p>
<p style="margin:28px 0"><a href="{{ $actionUrl }}" style="display:inline-block;padding:12px 22px;border-radius:9px;background:#992c92;color:#fff;text-decoration:none;font-weight:bold">{{ $text('View details') }}</a></p>
<p><a href="mailto:{{ config('qfs.support_email') }}" style="color:#992c92">{{ $text('Contact support for more information') }}</a></p>
<p style="font-size:12px;color:#666">{{ $text('Keep recovery links private. QFS will never ask for your wallet seed phrase or private key.') }}</p>
</div></body></html>
