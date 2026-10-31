// Test-only autopilot for the end-to-end flight: take-off pitch, a hands-on approach and a
// landing with flare, RETARD, reverse and brakes. Not a game feature: browser-e2e.mjs injects
// it as window.__fsController, which main.js calls once per frame after the keyboard.

(() => {
  const DEG = Math.PI / 180, FT = 3.28084, KT = 1.943844;
  const fs = window.__fs;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const log = (window.__e2eLog = []);
  const note = (m) => { log.push(`${fs.sim.state.t.toFixed(1)}s ${m}`); };

  const ctl = (window.__e2e = { phase: 'idle', vapp: 140, note, pitchI: 0 });

  // Flight path tracking through the Normal-law stick (load-factor demand), a PI loop.
  function holdGamma(c, s, gammaCmd, dt, kp = 0.22, ki = 0.05) {
    const gamma = Math.asin(clamp(s.vs / Math.max(s.tas, 30), -1, 1)) / DEG;
    const err = gammaCmd - gamma;
    ctl.pitchI = clamp(ctl.pitchI + err * ki * dt, -0.3, 0.3);
    c.pitch = clamp(kp * err + ctl.pitchI, -1, 1);
    return gamma;
  }
  // Track a course (grid rad) with bank, through the roll-rate stick.
  function holdTrack(c, s, trackCmd, maxBank = 15) {
    const track = Math.atan2(s.vel.x, s.vel.y);
    const bankCmd = clamp(wrap(trackCmd - track) / DEG * 2.0, -maxBank, maxBank);
    c.roll = clamp((bankCmd - s.roll / DEG) * 0.06, -1, 1);
  }

  window.__fsController = (sim, dt) => {
    const s = sim.state, c = sim.controls, ap = sim.ap;
    if (ctl.phase === 'takeoff') {
      // Rotate at VR to ~12.5° and hold it, then keep a 15° climb path-ish until 400 ft.
      const vr = ctl.vr || 145;
      if (s.onGround) {
        c.roll = 0;
        const track = Math.atan2(Math.sin(s.hdg), Math.cos(s.hdg));
        c.yaw = clamp(wrap(ctl.rwyHdg - track) / DEG * 0.4 - s.r * 2, -1, 1);
        // Rotate at about 2.5°/s, holding 9.5° on the wheels (the tail strikes near 10–11°).
        if (s.ias * KT >= vr) {
          if (ctl.rotateT === undefined) { ctl.rotateT = s.t; note('rotate at ' + (s.ias * KT).toFixed(0) + ' kt'); }
          const target = Math.min(9.5, (s.t - ctl.rotateT) * 2.5);
          c.pitch = clamp((target - s.pitch / DEG) * 0.3 - s.q / DEG * 0.05, -0.5, 0.7);
        } else c.pitch = 0;
      } else {
        c.yaw = 0;
        if (ctl.liftT === undefined) { ctl.liftT = s.t; note('lift-off at ' + (s.ias * KT).toFixed(0) + ' kt, pitch ' + (s.pitch / DEG).toFixed(1)); }
        const target = Math.min(15, 9.5 + (s.t - ctl.liftT) * 1.5);
        c.pitch = clamp((target - s.pitch / DEG) * 0.15 - s.q * 1.5, -0.6, 0.6);
        holdTrack(c, s, ctl.rwyHdg, 5);
      }
    } else if (ctl.phase === 'approach' || ctl.phase === 'flare') {
      const ax = ctl.axis;
      const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty;
      const along = rx * ax.ux + ry * ax.uy;           // < 0 before the threshold
      const cross = rx * ax.uy - ry * ax.ux;           // > 0 right of the centreline
      const aim = 400; // the aiming point on a runway of 2,400 m or more
      const hTarget = ax.elev + Math.tan(3 * DEG) * (aim - along);
      const hErr = s.pos.z - hTarget;
      const toGo = -along;
      // Configuration by distance to the threshold.
      if (toGo < 9 * 1852 && !c.gearDown) { c.gearDown = true; note('gear down'); }
      if (toGo < 10 * 1852 && c.flapLever < 2) { c.flapLever = 2; note('flaps 2'); }
      if (toGo < 8 * 1852 && c.flapLever < 3) { c.flapLever = 3; note('flaps 3'); }
      if (toGo < 7 * 1852 && c.flapLever < 4) { c.flapLever = 4; c.spoilersArmed = true; note('flaps FULL, spoilers armed'); }
      // Skip to final starts on the 3° path, so hand-fly it from there (A/THR keeps the speed).
      if (ap.ap) { ap.disconnectAp('test'); note('AP off at ' + Math.round(s.agl * FT) + ' ft, ' + (toGo / 1852).toFixed(1) + ' nm'); }
      if (c.flapLever >= 4 && s.vls > 0) ctl.vapp = Math.round(s.vls * KT + 5); // Vapp = VLS + 5 kt
      if (ap.athr && Math.abs(ap.spdKt - ctl.vapp) > 0.5 && c.flapLever >= 3) ap.setSpd(ctl.vapp);

      const ftAgl = s.agl * FT;
      if (ctl.phase === 'approach' && !ap.ap) {
        const gammaCmd = -3 - clamp(hErr * 0.04, -2, 2);
        holdGamma(c, s, gammaCmd, dt);
        const corr = clamp(-cross * 0.004, -0.35, 0.35); // rad of intercept
        holdTrack(c, s, ax.hdg + corr, toGo < 1000 ? 5 : 15);
        if (ftAgl < 50) { ctl.phase = 'flare'; note('flare at ' + ftAgl.toFixed(0) + ' ft'); }
      } else if (ctl.phase === 'flare') {
        if (!s.onGround) {
          // Ease the sink from the approach rate to ~ -0.8 m/s (150 ft/min) at the wheels.
          if (ctl.flareVs0 === undefined) ctl.flareVs0 = s.vs;
          const k = clamp(s.agl / 15, 0, 1) ** 1.5; // 15 m ≈ 50 ft
          const vsCmd = -0.6 + (ctl.flareVs0 + 0.6) * k;
          c.pitch = clamp((vsCmd - s.vs) * 0.25 - s.q * 0.8 + ctl.pitchI, -0.3, 0.7);
          const corr = clamp(-cross * 0.004, -0.1, 0.1);
          holdTrack(c, s, ax.hdg + corr, 3);
          c.yaw = clamp(wrap(ax.hdg - s.hdg) / DEG * 0.15, -0.5, 0.5); // decrab
          if (ftAgl < 20 && fs.input.lever > 0) { if (ap.athr) ap.toggleAthr(); fs.input.lever = 0; note('retard'); }
        } else {
          if (!ctl.td) { ctl.td = s.t; note('touchdown'); }
          c.pitch = s.wow.nose ? 0 : -0.15;
          c.roll = 0;
          const corr = clamp(-cross * 0.01, -0.1, 0.1);
          c.yaw = clamp((wrap(ax.hdg + corr - s.hdg) / DEG) * 0.5, -1, 1);
          if (fs.input.lever > 0) fs.input.lever = 0;
          if (s.wow.nose && s.ias * KT > 70) { fs.input.lever = -1; c.thrust = -1; }
          else if (s.ias * KT <= 70) { fs.input.lever = 0; c.thrust = 0; }
          c.brakeL = c.brakeR = s.wow.nose && s.t - ctl.td > 1.5 ? 0.6 : 0;
          if (s.gs < 1) { ctl.phase = 'stopped'; note('stopped'); }
        }
      }
    } else if (ctl.phase === 'stopped') {
      c.brakeL = c.brakeR = 1;
      fs.input.lever = 0;
    }
  };
})();
