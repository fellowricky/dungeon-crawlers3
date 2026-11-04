"""Synthesize the spell-charge swell: the sound of the half-second charge at a caster's chest.

A soft breath of air settling downward with a faint falling tone inside it. It eases in from silence and crests just as
the 0.5 s charge ends (render/body_fx.js SPELL_CHARGE_SECONDS), so the spell's own sound takes over from it instead
of starting cold. Nothing here is sampled; rerun to retune.

  python tools/sfx/make_spell_charge.py
"""
import wave
from pathlib import Path

import numpy as np

SR = 44100
LENGTH = 0.58          # the crest, then a short release under the spell's own sound
CREST = 0.46           # just before the charge ends, so the swell hands over rather than collides
PEAK = 0.40            # quiet at source: this sits under everything


def swell(seed, tone_from, tone_to, air_from, air_to):
    rng = np.random.default_rng(seed)
    n = int(SR * LENGTH)
    t = np.arange(n) / SR
    k = np.clip(t / CREST, 0, 1)

    # air: white noise through a band-pass whose centre glides across the charge
    noise = rng.standard_normal(n)
    centre = air_from * (air_to / air_from) ** (k ** 1.4)
    low = band = 0.0
    air = np.zeros(n)
    for i in range(n):
        f = 2 * np.sin(np.pi * centre[i] / SR)
        high = noise[i] - low - 0.9 * band        # 0.9: a broad, breathy resonance
        band += f * high
        low += f * band
        air[i] = band
    air /= np.abs(air).max()

    # tone: two slightly detuned sines gliding, with a fifth above them that arrives late
    freq = tone_from * (tone_to / tone_from) ** (k ** 1.6)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    tone = np.sin(phase) + np.sin(phase * 1.006) + 0.5 * k ** 2 * np.sin(phase * 1.5)
    tone /= np.abs(tone).max()

    # ease in from nothing, crest, then a quick smooth release with no click at either end
    env = k ** 2.2 * (3 - 2 * k) ** 0.5
    after = t > CREST
    env[after] = np.cos((t[after] - CREST) / (LENGTH - CREST) * np.pi / 2) ** 2

    out = (0.72 * air + 0.28 * tone) * env
    return out / np.abs(out).max() * PEAK


def save(path, x):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(path, f'{len(x) / SR:.2f}s')


out = Path(__file__).resolve().parents[2] / 'public' / 'sounds' / 'Spells'
save(out / 'Spell Charge 1.wav', swell(11, 392, 196, 3200, 500))
save(out / 'Spell Charge 2.wav', swell(29, 440, 220, 2800, 450))
