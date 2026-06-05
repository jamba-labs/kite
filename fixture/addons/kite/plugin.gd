@tool
extends EditorPlugin
## Registers the KiteHarness autoload when the plugin is enabled in the editor.
## (The fixture project registers the autoload directly in project.godot
## instead, so it works headless without an editor enable step.)

const AUTOLOAD_NAME := "KiteHarness"


func _enter_tree() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, "res://addons/kite/kite_harness.gd")


func _exit_tree() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
