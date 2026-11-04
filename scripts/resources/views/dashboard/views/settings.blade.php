<div class="account-settings" x-data="accountSettings()" :aria-busy="!!busy">
    <template x-if="error"><p class="dash-form-error" role="alert"><span x-text="error"></span> <button class="dash-btn ghost" x-show="!data" @click="load()">Retry</button></p></template>
    <template x-if="message"><div class="dash-success-message" role="status"><x-dash-icon name="check" :size="18" /><p x-text="message"></p></div></template>
    <template x-if="!data && !error"><p class="dash-input-note" role="status">Loading account settings…</p></template>

    <template x-if="data">
        <div>
            {{-- Profile --}}
            <section>
                <header><h2>Profile</h2><p>{{ $tx('Your display details. Verified identity details are managed through identity verification.') }}</p></header>
                <form @submit="submit($event, 'profile')"><fieldset :disabled="!!busy">
                    <div class="account-form-grid">
                        <label class="dash-form-group"><span>Display name</span><input class="dash-input" name="name" :value="data.user.name" autocomplete="name" minlength="2" maxlength="120" required></label>
                        <label class="dash-form-group"><span>Phone number</span><input class="dash-input" name="phone" type="tel" :value="data.user.phone || ''" autocomplete="tel" maxlength="24"></label>
                        <label class="dash-form-group"><span>Country</span><input class="dash-input" name="country" :value="data.user.country" autocomplete="country-name" minlength="2" maxlength="80" required></label>
                        <label class="dash-form-group"><span>Email address</span><input class="dash-input" type="email" :value="data.user.email" readonly></label>
                    </div>
                    <button class="dash-btn primary" :disabled="!!busy" type="submit"><span x-text="busy === 'profile' ? 'Saving…' : 'Save profile'"></span></button>
                </fieldset></form>
            </section>

            {{-- Password --}}
            <section>
                <header><h2>Password</h2><p>Changing your password signs out your other devices.</p></header>
                <form @submit="submit($event, 'password')"><fieldset :disabled="!!busy">
                    <label class="dash-form-group"><span>Current password</span><input class="dash-input" type="password" name="currentPassword" autocomplete="current-password" required maxlength="200"></label>
                    <template x-if="data.twoFactorEnabled"><label class="dash-form-group"><span>Authenticator or recovery code</span><input class="dash-input" name="code" autocomplete="one-time-code" required maxlength="30"></label></template>
                    <div class="account-form-grid">
                        <label class="dash-form-group"><span>New password</span><input class="dash-input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="72" required></label>
                        <label class="dash-form-group"><span>Confirm new password</span><input class="dash-input" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="72" required></label>
                    </div>
                    <p class="account-hint">Use at least 10 characters, including a letter and a number.</p>
                    <button class="dash-btn primary" :disabled="!!busy" type="submit"><span x-text="busy === 'password' ? 'Saving…' : 'Change password'"></span></button>
                </fieldset></form>
            </section>

            {{-- Two-factor --}}
            <section>
                <header><h2>Two-factor authentication</h2><p x-text="data.twoFactorEnabled ? 'Enabled. Sign-in requires your password and an authenticator or recovery code.' : 'Add an authenticator app to protect your account. Recommended for administrators.'"></p></header>
                <template x-if="codes.length">
                    <div class="account-recovery">
                        <strong>Save these recovery codes now</strong><p>Each code works once. These codes will not be displayed again.</p>
                        <div><template x-for="c in codes" :key="c"><code dir="ltr" x-text="c"></code></template></div>
                        <button type="button" class="dash-btn ghost" @click="downloadCodes()">Download recovery codes</button>
                        <button type="button" class="dash-btn ghost" @click="codes = []">I have saved my codes</button>
                    </div>
                </template>
                <template x-if="!data.twoFactorEnabled && !setup">
                    <form @submit="submit($event, 'setup')"><fieldset :disabled="!!busy">
                        <label class="dash-form-group"><span>Current password</span><input class="dash-input" type="password" name="currentPassword" autocomplete="current-password" required></label>
                        <button class="dash-btn primary" type="submit" :disabled="!!busy"><span x-text="busy === 'setup' ? 'Saving…' : 'Set up authenticator'"></span></button>
                    </fieldset></form>
                </template>
                <template x-if="!data.twoFactorEnabled && setup">
                    <div>
                        <p>Enter this setup key in your authenticator app, or scan its QR there. Setup expires in 10 minutes.</p>
                        <div class="account-setup"><code dir="ltr" x-text="setup.secret"></code></div>
                        <form @submit="submit($event, 'ENABLE')"><fieldset :disabled="!!busy">
                            <label class="dash-form-group"><span>Current password</span><input class="dash-input" type="password" name="currentPassword" autocomplete="current-password" required></label>
                            <label class="dash-form-group"><span>Authenticator code</span><input class="dash-input" name="code" autocomplete="one-time-code" required maxlength="30"></label>
                            <button class="dash-btn primary" type="submit" :disabled="!!busy">Enable two-factor authentication</button>
                            <button class="dash-btn ghost" type="button" @click="setup = null">Cancel</button>
                        </fieldset></form>
                    </div>
                </template>
                <template x-if="data.twoFactorEnabled">
                    <div>
                        <p class="account-hint">Recovery codes remaining: <span x-text="data.recoveryCodesRemaining"></span></p>
                        <details><summary>Manage two-factor authentication</summary>
                            <form @submit="submit($event, manageAction)"><fieldset :disabled="!!busy">
                                <label class="dash-form-group"><span>Current password</span><input class="dash-input" type="password" name="currentPassword" autocomplete="current-password" required></label>
                                <label class="dash-form-group"><span>Authenticator or recovery code</span><input class="dash-input" name="code" autocomplete="one-time-code" required maxlength="30"></label>
                                <button class="dash-btn ghost" type="submit" @click="manageAction = 'RECOVERY_CODES'" :disabled="!!busy">Replace recovery codes</button>
                                <button class="dash-btn ghost" type="submit" @click="manageAction = 'DISABLE'" :disabled="!!busy">Disable two-factor authentication</button>
                            </fieldset></form>
                        </details>
                    </div>
                </template>
            </section>

            {{-- Sessions --}}
            <section>
                <header><h2>Active sessions</h2><p>Review where your account is signed in. Device details are reported by the browser.</p></header>
                <ul class="account-sessions">
                    <template x-for="s in data.sessions" :key="s.id">
                        <li>
                            <div><strong x-text="s.current ? 'This device' : 'Other device'"></strong><span x-text="s.userAgent || 'Device details unavailable'"></span><small><span x-text="s.ipAddress || '—'"></span> · Last active <span x-text="date(s.lastSeenAt || s.createdAt)"></span></small></div>
                            <button class="dash-btn ghost" x-show="!s.current" @click="revokeId = s.id" :disabled="!!busy">Sign out device</button>
                        </li>
                    </template>
                </ul>
                <template x-if="revokeId">
                    <form @submit="submit($event, 'revoke')"><fieldset :disabled="!!busy">
                        <h3>Confirm session sign-out</h3>
                        <label class="dash-form-group"><span>Current password</span><input class="dash-input" type="password" name="currentPassword" autocomplete="current-password" required></label>
                        <template x-if="data.twoFactorEnabled"><label class="dash-form-group"><span>Authenticator or recovery code</span><input class="dash-input" name="code" autocomplete="one-time-code" required maxlength="30"></label></template>
                        <button class="dash-btn primary" type="submit" :disabled="!!busy">Confirm sign out</button>
                        <button class="dash-btn ghost" type="button" @click="revokeId = ''">Cancel</button>
                    </fieldset></form>
                </template>
            </section>
        </div>
    </template>
</div>
