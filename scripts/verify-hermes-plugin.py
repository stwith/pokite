"""Run with the Hermes runtime Python: tests require its FastAPI dependency."""
import importlib.util
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "integrations/hermes-desktop/dashboard/plugin_api.py"
spec = importlib.util.spec_from_file_location("pokite_plugin_test", source)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.owner = object()
        self.detached = object()
        self.bound = None
        self.calls = []
        self.session = {"transport": self.owner}
        self.server = types.SimpleNamespace(
            _sessions={"native": self.session},
            _sessions_lock=threading.Lock(),
            _detached_ws_transport=self.detached,
            _session_live_status=lambda sid, session: "idle",
            bind_transport=self.bind,
            reset_transport=self.reset,
            handle_request=self.handle,
        )
        self.modules = patch.dict(sys.modules, {"tui_gateway": types.SimpleNamespace(server=self.server)})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def bind(self, transport):
        previous = self.bound
        self.bound = transport
        return previous

    def reset(self, previous):
        self.bound = previous

    def handle(self, request):
        self.assertIs(self.bound, self.owner)
        self.calls.append(request)
        return {"result": {"status": "streaming"}}

    def test_original_owner_is_preserved(self):
        result = plugin.send(plugin.Prompt(session_id="native", text="hello"))
        self.assertEqual(result["status"], "streaming")
        self.assertIs(self.session["transport"], self.owner)
        self.assertIsNone(self.bound)
        self.assertEqual(self.calls[0]["method"], "prompt.submit")
        self.assertTrue(self.calls[0]["params"]["queued"])

    def test_busy_does_not_dispatch_or_interrupt(self):
        self.server._session_live_status = lambda *args: "working"
        with self.assertRaises(plugin.HTTPException) as error:
            plugin.send(plugin.Prompt(session_id="native", text="hello"))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.calls, [])

    def test_disconnected_owner_is_not_replaced(self):
        self.session["transport"] = self.detached
        with self.assertRaises(plugin.HTTPException):
            plugin.send(plugin.Prompt(session_id="native", text="hello"))
        self.assertEqual(self.calls, [])

    def test_failed_handler_restores_context(self):
        def fail(request):
            raise RuntimeError("fixture")
        self.server.handle_request = fail
        with self.assertRaises(RuntimeError):
            plugin.send(plugin.Prompt(session_id="native", text="hello"))
        self.assertIsNone(self.bound)
        self.assertIs(self.session["transport"], self.owner)


if __name__ == "__main__":
    unittest.main()
