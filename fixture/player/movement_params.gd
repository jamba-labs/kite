class_name MovementParams
# Fixture tuning constants. Floaty by default (the demo's "before"). Closed-form
# so the metrics are checkable by hand: apex = JUMP_VELOCITY/GRAVITY_RISE,
# rise:fall = sqrt(GRAVITY_FALL/GRAVITY_RISE), ground curves follow the exponents.

# Jump
const JUMP_VELOCITY := 260.0   # px/s
const GRAVITY_RISE := 500.0    # px/s^2 rising
const GRAVITY_FALL := 500.0    # px/s^2 falling

# Ground: v(t) = MAX_SPEED * (t/ACCEL_TIME)^ACCEL_EXPONENT, decel mirrored
const MAX_SPEED := 200.0
const ACCEL_TIME := 0.45
const ACCEL_EXPONENT := 1.0
const DECEL_TIME := 0.40
const DECEL_EXPONENT := 1.0

# Assists in ms (0 = off)
const COYOTE_MS := 0.0
const BUFFER_MS := 0.0

# Artificial latency on every input; lets the latency metric be checked against
# a known answer. Keep 0 for feel work.
const INPUT_DELAY_FRAMES := 0
