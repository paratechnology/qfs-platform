<div x-data="kycFlow(@js($u['name'] ?? ''))">
    <template x-if="loading"><p class="dash-input-note" role="status">Loading your verification…</p></template>
    <template x-if="!loading && !record && error"><p class="dash-form-error" role="alert"><span x-text="error"></span> <button class="dash-btn ghost" @click="load()">{{ $tx('Retry') }}</button></p></template>

    {{-- Approved / pending --}}
    <template x-if="record && (record.status === 'APPROVED' || record.status === 'PENDING')">
        <section class="dash-kyc-status">
            <x-dash-icon name="check" :size="24" />
            <h2 x-text="record.status === 'APPROVED' ? 'Identity verified' : 'Documents submitted'"></h2>
            <p x-text="record.status === 'APPROVED' ? 'Your identity documents have been approved by the review team.' : 'Your documents are awaiting admin review. You’ll receive an account notification when a decision is made.'"></p>
            <template x-if="record.reviewNote"><p x-text="record.reviewNote"></p></template>
        </section>
    </template>

    {{-- Wizard --}}
    <template x-if="record && record.status !== 'APPROVED' && record.status !== 'PENDING'">
        <section class="dash-kyc-flow">
            <template x-if="message"><div class="dash-success-message" role="status"><x-dash-icon name="check" :size="18" /><p x-text="message"></p></div></template>
            <template x-if="record.status === 'NEEDS_CHANGES'"><div class="dash-notice" role="status"><span><strong>{{ $tx('Changes requested') }}</strong><br><span x-text="record.reviewNote"></span></span></div></template>

            <ol class="dash-kyc-steps" aria-label="{{ $tx('Verification steps') }}">
                <li :aria-current="step === 0 ? 'step' : null"><span>1</span>{{ $tx('Your details') }}</li>
                <li :aria-current="step === 1 ? 'step' : null"><span>2</span>{{ $tx('Documents') }}</li>
                <li :aria-current="step === 2 ? 'step' : null"><span>3</span>Review &amp; submit</li>
            </ol>
            <template x-if="error"><div class="dash-load-error" role="alert" x-text="error"></div></template>

            <fieldset class="dash-form-fieldset" :disabled="!!busy">
                {{-- Step 1: details --}}
                <form x-show="step === 0" @submit.prevent="saveDetails()">
                    <div class="dash-kyc-fields">
                        <div class="dash-form-group"><label for="kyc-legalName">{{ $tx('Full legal name') }}</label><input class="dash-input" required maxlength="120" autocomplete="name" id="kyc-legalName" x-model="fields.legalName"></div>
                        <div class="dash-form-group"><label for="kyc-dateOfBirth">{{ $tx('Date of birth') }}</label><input class="dash-input" type="date" required autocomplete="bday" id="kyc-dateOfBirth" x-model="fields.dateOfBirth"></div>
                        <div class="dash-form-group"><label for="kyc-country">{{ $tx('Country of residence') }}</label><input class="dash-input" required maxlength="80" autocomplete="country-name" id="kyc-country" x-model="fields.country"></div>
                        <div class="dash-form-group"><label for="kyc-documentType">{{ $tx('Identity document') }}</label>
                            <select class="dash-select" id="kyc-documentType" x-model="fields.documentType">
                                <option value="PASSPORT">{{ $tx('Passport') }}</option>
                                <option value="NATIONAL_ID">{{ $tx('National identity card') }}</option>
                                <option value="DRIVING_LICENSE">{{ $tx('Driving licence') }}</option>
                            </select>
                        </div>
                    </div>
                    <div class="dash-form-group"><label for="kyc-address">{{ $tx('Residential address') }}</label><textarea class="dash-input" required maxlength="500" rows="3" autocomplete="street-address" id="kyc-address" x-model="fields.address"></textarea></div>
                    <button class="dash-btn primary" type="submit" :disabled="!!busy"><span x-text="busy || 'Save & continue'"></span></button>
                </form>

                {{-- Step 2: documents --}}
                <div x-show="step === 1" x-cloak>
                    <p class="dash-input-note">{{ $tx('Upload clear, uncropped images. JPG, PNG, or PDF, up to 3 MB per file. Your face photo must be JPG or PNG.') }}</p>
                    <div class="dash-kyc-upload-list">
                        <template x-for="kind in required" :key="kind">
                            <div class="dash-kyc-upload">
                                <div>
                                    <strong x-text="label(kind)"></strong>
                                    <span x-text="hasFile(kind) ? 'Uploaded securely' : (kind === 'PORTRAIT' ? 'A recent photo with your face clearly visible' : 'All text and document edges must be visible')"></span>
                                    <template x-if="hasFile(kind)"><a :href="fileUrl(kind)" target="_blank" rel="noreferrer">{{ $tx('Download uploaded file') }}</a></template>
                                </div>
                                <label class="dash-btn ghost">
                                    <span x-text="hasFile(kind) ? 'Replace' : 'Choose file'"></span>
                                    <input type="file" :aria-label="(hasFile(kind) ? 'Replace ' : 'Upload ') + label(kind)" :accept="kind === 'PORTRAIT' ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'" @change="upload(kind, $event)">
                                </label>
                            </div>
                        </template>
                    </div>
                    <div class="dash-actions-row">
                        <button class="dash-btn ghost" @click="step = 0">{{ $tx('Back') }}</button>
                        <button class="dash-btn primary" :disabled="!complete" @click="step = 2">{{ $tx('Review submission') }}</button>
                    </div>
                </div>

                {{-- Step 3: review --}}
                <div x-show="step === 2" x-cloak>
                    <dl class="dash-investment-terms">
                        <div><dt>{{ $tx('Legal name') }}</dt><dd x-text="fields.legalName"></dd></div>
                        <div><dt>{{ $tx('Date of birth') }}</dt><dd x-text="fields.dateOfBirth"></dd></div>
                        <div><dt>{{ $tx('Country') }}</dt><dd x-text="fields.country"></dd></div>
                        <div><dt>{{ $tx('Address') }}</dt><dd x-text="fields.address"></dd></div>
                    </dl>
                    <p class="dash-input-note">{{ $tx('Documents are stored privately and reviewed by authorised admins. This review does not include automated liveness checks.') }}</p>
                    <label class="dash-kyc-consent"><input type="checkbox" x-model="consent"> {{ $tx('I confirm these details are mine and authorise their review for identity verification.') }}</label>
                    <div class="dash-actions-row">
                        <button class="dash-btn ghost" @click="step = 1">{{ $tx('Back') }}</button>
                        <button class="dash-btn primary" :disabled="!consent || !complete" @click="submitReview()"><span x-text="busy || 'Submit for review'"></span></button>
                    </div>
                </div>
            </fieldset>
        </section>
    </template>
</div>

@include('partials.kyc-history', ['historyEndpoint' => json_encode('/api/kyc/history')])
