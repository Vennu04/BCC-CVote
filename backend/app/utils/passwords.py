import secrets

# Excludes visually ambiguous characters (0/O, 1/l/I) — these temp passwords
# get read aloud over the phone by admin, not typed by someone looking at a
# screen, so ambiguity there is the real risk, not entropy.
_TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def validate_password(password):
    """Returns an error string if invalid, None if OK. Deliberately simple —
    length + not-all-digits — suited for a non-technical user base, not the
    forced-symbol/mixed-case rules that frustrate this kind of audience."""
    if len(password) < 6:
        return "Password must be at least 6 characters"
    if password.isdigit():
        return "Password can't be all numbers"
    return None


def generate_temp_password(length=8):
    """A random temp password for admin-assisted resets — always passes
    validate_password() by construction (alphabet includes letters, so it
    can never be all-digit)."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))
