@extends('layouts.admin')
@section('title', 'Account security | QFS')
@section('admin-content')
<div class="adm-page-head"><div><h1>{{ $tx('Account security') }}</h1><p>Manage your own admin account: profile, password, two-factor authentication and active sessions.</p></div></div>
@include('dashboard.views.settings')
@endsection
