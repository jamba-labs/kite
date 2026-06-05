class_name Player
extends CharacterBody2D
# Fixture controller. Feel is tuned in movement_params.gd, not here. All movement
# runs in _physics_process at the fixed tick rate (no RNG, no wall-clock) so runs
# are deterministic.

# State machine, recorded by the addon as the entity's `s` field.
var state := "idle"

var _move_dir := 0.0
var _accel_t := 0.0
var _decel_t := 0.0
var _decel_v0 := 0.0
var _coyote_left := 0.0
var _buffer_left := 0.0

# FIFO of [move_dir, jump_pressed] for the artificial input delay.
var _input_queue: Array = []


func _physics_process(delta: float) -> void:
	_input_queue.push_back([
		Input.get_axis("move_left", "move_right"),
		Input.is_action_just_pressed("jump"),
	])
	if _input_queue.size() <= MovementParams.INPUT_DELAY_FRAMES:
		return
	var inp: Array = _input_queue.pop_front()
	var dir: float = signf(inp[0])
	var jump_pressed: bool = inp[1]

	_apply_horizontal(dir, delta)
	_apply_vertical(jump_pressed, delta)
	move_and_slide()
	_update_state(dir)


func _apply_horizontal(dir: float, delta: float) -> void:
	if dir != 0.0:
		if dir != _move_dir:
			_accel_t = 0.0  # direction change restarts the envelope
		_move_dir = dir
		_accel_t += delta
		velocity.x = dir * MovementParams.MAX_SPEED \
				* pow(_phase(_accel_t, MovementParams.ACCEL_TIME), MovementParams.ACCEL_EXPONENT)
	else:
		if _move_dir != 0.0:
			_move_dir = 0.0
			_decel_t = 0.0
			_decel_v0 = velocity.x
		_decel_t += delta
		velocity.x = _decel_v0 \
				* pow(1.0 - _phase(_decel_t, MovementParams.DECEL_TIME), MovementParams.DECEL_EXPONENT)
		_accel_t = 0.0


func _apply_vertical(jump_pressed: bool, delta: float) -> void:
	if not is_on_floor():
		var g := MovementParams.GRAVITY_RISE if velocity.y < 0.0 else MovementParams.GRAVITY_FALL
		velocity.y += g * delta

	if is_on_floor():
		_coyote_left = MovementParams.COYOTE_MS / 1000.0
	else:
		_coyote_left = maxf(_coyote_left - delta, 0.0)
	if jump_pressed:
		_buffer_left = MovementParams.BUFFER_MS / 1000.0
	else:
		_buffer_left = maxf(_buffer_left - delta, 0.0)

	var wants_jump := jump_pressed or _buffer_left > 0.0
	var can_jump := is_on_floor() or _coyote_left > 0.0
	if wants_jump and can_jump and velocity.y >= 0.0:
		velocity.y = -MovementParams.JUMP_VELOCITY
		_coyote_left = 0.0
		_buffer_left = 0.0


func _update_state(dir: float) -> void:
	if is_on_floor():
		state = "run" if (dir != 0.0 or absf(velocity.x) > 0.5) else "idle"
	else:
		state = "jump" if velocity.y < 0.0 else "fall"


# Envelope phase in [0, 1]; zero-length completes instantly.
func _phase(t: float, duration: float) -> float:
	if duration <= 0.0:
		return 1.0
	return clampf(t / duration, 0.0, 1.0)
