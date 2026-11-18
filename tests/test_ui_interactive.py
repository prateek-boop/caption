import asyncio
import json
import subprocess
import time
import urllib.request
import websockets

async def run_test():
    proc = subprocess.Popen([
        "/usr/bin/chromium",
        "--headless",
        "--remote-debugging-port=9222",
        "--no-sandbox",
        "--disable-gpu",
        "http://localhost:8080"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    time.sleep(2)
    try:
        targets_res = urllib.request.urlopen("http://localhost:9222/json")
        targets = json.loads(targets_res.read())
        ws_url = targets[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url) as ws:
            msg_id = 0

            async def send_cmd(method, params=None):
                nonlocal msg_id
                msg_id += 1
                payload = {"id": msg_id, "method": method, "params": params or {}}
                await ws.send(json.dumps(payload))
                while True:
                    raw = await ws.recv()
                    data = json.loads(raw)
                    if data.get("id") == msg_id:
                        return data.get("result", {})

            await send_cmd("Runtime.enable")
            await send_cmd("Page.enable")

            async def eval_js(expr):
                res = await send_cmd("Runtime.evaluate", {
                    "expression": expr,
                    "returnByValue": True,
                    "awaitPromise": True
                })
                if "exceptionDetails" in res:
                    raise Exception(f"JS Error: {res['exceptionDetails']}")
                return res.get("result", {}).get("value")

            print("=== Waiting for App Load ===")
            await asyncio.sleep(1.5)

            title = await eval_js("document.title")
            print(f"Page Title: {title}")
            assert "Captioner" in title

            # Check if Auth Modal is open or already logged in
            auth_hidden = await eval_js("document.getElementById('auth-modal').classList.contains('hidden')")
            print(f"Auth modal hidden initially: {auth_hidden}")

            if not auth_hidden:
                print("Clicking 'Continue as Guest'...")
                await eval_js("handleGuestLogin()")
                await asyncio.sleep(2)

            auth_hidden_after = await eval_js("document.getElementById('auth-modal').classList.contains('hidden')")
            print(f"Auth modal hidden after login: {auth_hidden_after}")
            assert auth_hidden_after, "Auth modal should be hidden after guest login"

            username = await eval_js("state.user ? state.user.username : ''")
            print(f"Logged in user: {username}")
            assert username == "guest"

            # 1. Test Profile Modal
            print("\n=== Testing User Profile Modal ===")
            # Check profile modal is hidden initially
            prof_hidden = await eval_js("document.getElementById('profile-modal').classList.contains('hidden')")
            assert prof_hidden, "Profile modal should be hidden initially"

            # Open via openProfileModal()
            print("Opening Profile Modal...")
            await eval_js("openProfileModal()")
            await asyncio.sleep(0.5)

            prof_hidden_after = await eval_js("document.getElementById('profile-modal').classList.contains('hidden')")
            assert not prof_hidden_after, "Profile modal should be visible"

            prof_user = await eval_js("document.getElementById('profile-modal-username').textContent")
            prof_token = await eval_js("document.getElementById('profile-token-display').value")
            print(f"Profile modal username: {prof_user}, Token length: {len(prof_token)}")
            assert prof_user == "guest"
            assert len(prof_token) > 20, "API Token should be populated"

            # Test tab switching in profile modal
            print("Testing Profile Modal tab switches...")
            await eval_js("switchProfileTab('security')")
            sec_visible = await eval_js("!document.getElementById('profile-pane-security').classList.contains('hidden')")
            assert sec_visible, "Security pane should be visible"

            await eval_js("switchProfileTab('prefs')")
            prefs_visible = await eval_js("!document.getElementById('profile-pane-prefs').classList.contains('hidden')")
            assert prefs_visible, "Preferences pane should be visible"

            await eval_js("switchProfileTab('api')")
            api_visible = await eval_js("!document.getElementById('profile-pane-api').classList.contains('hidden')")
            assert api_visible, "API pane should be visible"

            # Test token copy
            print("Testing Copy Token...")
            await eval_js("copyUserToken()")

            # Close profile modal
            print("Closing Profile Modal...")
            await eval_js("closeProfileModal()")
            await asyncio.sleep(0.3)
            prof_closed = await eval_js("document.getElementById('profile-modal').classList.contains('hidden')")
            assert prof_closed, "Profile modal should be closed"

            # 2. Test Shortcuts Modal
            print("\n=== Testing Keyboard Shortcuts Modal ===")
            await eval_js("openShortcutsModal()")
            await asyncio.sleep(0.3)
            sc_open = await eval_js("!document.getElementById('shortcuts-modal').classList.contains('hidden')")
            assert sc_open, "Shortcuts modal should be open"
            print("Shortcuts modal is open!")

            await eval_js("closeShortcutsModal()")
            await asyncio.sleep(0.3)
            sc_closed = await eval_js("document.getElementById('shortcuts-modal').classList.contains('hidden')")
            assert sc_closed, "Shortcuts modal should be closed"
            print("Shortcuts modal closed successfully!")

            # 3. Test Dashboard Search & Filter Pills
            print("\n=== Testing Dashboard Search & Filter Pills ===")
            # Check filter pills exist
            filter_all_text = await eval_js("document.getElementById('filter-job-all').textContent.trim()")
            print(f"Filter All pill: {filter_all_text}")
            assert "All" in filter_all_text

            # Set filter to completed
            await eval_js("setJobFilter('completed')")
            active_filter = await eval_js("currentJobFilter")
            assert active_filter == "completed", "Active filter should be 'completed'"
            print(f"Active filter set to: {active_filter}")

            # Reset filter to all
            await eval_js("setJobFilter('all')")
            assert (await eval_js("currentJobFilter")) == "all"

            # Test Dashboard Search
            print("Testing Dashboard Search input...")
            await eval_js("handleDashboardSearch('test_sample')")
            search_query = await eval_js("currentJobSearchQuery")
            assert search_query == "test_sample", f"Search query should be test_sample, got {search_query}"
            clear_btn_visible = await eval_js("!document.getElementById('btn-clear-dash-search').classList.contains('hidden')")
            assert clear_btn_visible, "Clear search button should be visible when searching"

            await eval_js("clearDashboardSearch()")
            assert (await eval_js("currentJobSearchQuery")) == ""
            print("Dashboard search and clear verified successfully!")

            # 4. Test Model Presets in Upload Studio
            print("\n=== Testing Model Presets in Upload Studio ===")
            await eval_js("navigate('new-transcription')")
            await asyncio.sleep(0.5)

            await eval_js("selectModelPreset('fast')")
            mod_val = await eval_js("document.getElementById('config-model').value")
            cmp_val = await eval_js("document.getElementById('config-compute-type').value")
            print(f"Fast preset -> Model: {mod_val}, Compute: {cmp_val}")
            assert mod_val == "tiny"
            assert cmp_val == "int8"

            await eval_js("selectModelPreset('accurate')")
            mod_val2 = await eval_js("document.getElementById('config-model').value")
            print(f"Accurate preset -> Model: {mod_val2}")
            assert mod_val2 == "large-v3"

            # 5. Test 3D Clipper Micro-nudge & Preset Duration
            print("\n=== Testing 3D Clipper Controls ===")
            await eval_js("navigate('clipper')")
            await asyncio.sleep(0.5)

            # Set mock duration to test nudging
            await eval_js("clipperState.duration = 60.0; clipperState.inTime = 10.0; clipperState.outTime = 30.0; updateClipperTimelineUI();")
            initial_in = await eval_js("clipperState.inTime")
            initial_out = await eval_js("clipperState.outTime")
            print(f"Initial In: {initial_in}s, Out: {initial_out}s")

            # Nudge In +1s
            await eval_js("nudgeClipperIn(1.0)")
            nudged_in = await eval_js("clipperState.inTime")
            print(f"Nudged In +1s: {nudged_in}s")
            assert abs(nudged_in - 11.0) < 0.001

            # Nudge Out -1s
            await eval_js("nudgeClipperOut(-1.0)")
            nudged_out = await eval_js("clipperState.outTime")
            print(f"Nudged Out -1s: {nudged_out}s")
            assert abs(nudged_out - 29.0) < 0.001

            # Preset duration 15s
            await eval_js("setClipPresetDuration(15)")
            dur = await eval_js("clipperState.outTime - clipperState.inTime")
            print(f"Preset 15s Duration: {dur}s")
            assert abs(dur - 15.0) < 0.001

            # 6. Test Clips Library Search
            print("\n=== Testing Clips Library Search ===")
            await eval_js("navigate('clips')")
            await asyncio.sleep(0.5)
            await eval_js("handleClipsSearch('podcast')")
            clips_search = await eval_js("currentClipsSearchQuery")
            assert clips_search == "podcast"
            print("Clips search handled successfully!")

            print("\n==============================================")
            print("✅ ALL INTERACTIVE FRONTEND TESTS PASSED 100%!")
            print("==============================================")

    finally:
        proc.terminate()
        proc.wait()

asyncio.run(run_test())
