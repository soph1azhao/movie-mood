export class ProviderConfigError extends Error {
  code: string

  constructor(message: string, code = 'PROVIDER_CONFIG_ERROR') {
    super(message)
    this.name = 'ProviderConfigError'
    this.code = code
  }
}

export function resolveCredential({
  credentialEnv,
  env = process.env,
}: {
  credentialEnv: string
  env?: Record<string, string | undefined>
}): string {
  if (!credentialEnv || typeof credentialEnv !== 'string') {
    throw new ProviderConfigError('Provider credentials must be referenced by environment variable name.', 'MISSING_CREDENTIAL_ENV')
  }

  const credential = env[credentialEnv]
  if (!credential) {
    throw new ProviderConfigError(`Required provider credential env var is missing: ${credentialEnv}`, 'MISSING_PROVIDER_CREDENTIAL')
  }

  return credential
}

export function assertCredentialIsolation(config: Record<string, unknown>): void {
  const forbiddenFields = ['apiKey', 'token', 'secret', 'password', 'credential']
  const leakedField = forbiddenFields.find((field) => typeof config[field] === 'string' && String(config[field]).trim().length > 0)

  if (leakedField) {
    throw new ProviderConfigError(
      `Provider config must not contain inline credentials; use credentialEnv instead of ${leakedField}.`,
      'INLINE_PROVIDER_CREDENTIAL',
    )
  }
}

export function loadProviderConfig({
  config,
  env = process.env,
}: {
  config: Record<string, unknown>
  env?: Record<string, string | undefined>
}) {
  assertCredentialIsolation(config)

  const credentialEnv = config.credentialEnv
  if (typeof credentialEnv !== 'string') {
    throw new ProviderConfigError('Provider config requires credentialEnv.', 'MISSING_CREDENTIAL_ENV')
  }

  return {
    providerId: config.providerId,
    modelId: config.modelId,
    credentialEnv,
    credential: resolveCredential({ credentialEnv, env }),
  }
}
