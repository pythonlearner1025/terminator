"""Rebuild audio from the licensed source cache in .kite3d/audio-source.
Requires Python numpy/scipy, ffmpeg, and macOS say. Run from the project root.
Sources and processing for every shipped file are written to LICENSES.md.
"""
from pathlib import Path
import json, subprocess, numpy as np
from scipy.signal import butter, sosfilt, resample_poly

ROOT = Path('.kite3d/audio-source')
OUT = Path('assets/audio')
RATE = 44100
rng = np.random.default_rng(2029)
manifest = {}; credits = []; cache = {}
CC0 = 'CC0 1.0'
GUN = 'https://opengameart.org/content/the-free-firearm-sound-library'
RELOAD = 'https://opengameart.org/content/gun-reload-sounds'
SHELL = 'https://opengameart.org/content/shotgun-reload-sound-effects'

def read(path):
    path = str(path)
    if path not in cache:
        raw = subprocess.check_output(['ffmpeg','-v','error','-i',path,'-f','f32le','-ar',str(RATE),'-ac','1','pipe:1'])
        a = np.frombuffer(raw, dtype='<f4').copy()
        hits = np.flatnonzero(np.abs(a) > max(.008, np.max(np.abs(a)) * .025))
        if len(hits): a = a[max(0,hits[0]-int(.003*RATE)):min(len(a),hits[-1]+int(.08*RATE))]
        cache[path] = a
    return cache[path].copy()

def low(a,f): return sosfilt(butter(2,f,fs=RATE,output='sos'),a,axis=0)
def high(a,f): return sosfilt(butter(2,f,fs=RATE,btype='highpass',output='sos'),a,axis=0)
def speed(a, factor):
    return np.interp(np.arange(0,len(a)-1,factor),np.arange(len(a)),a)
def fit(a,seconds):
    count=int(seconds*RATE)
    return np.pad(a[:count],(0,max(0,count-len(a))))
def mix(*parts):
    out=np.zeros(max(len(a)+int(offset*RATE) for a,offset,gain in parts))
    for a,offset,gain in parts:
        start=int(offset*RATE);out[start:start+len(a)]+=a*gain
    return out

def save(file,a,origin,source,license=CC0,processing='Trim, mono fold, EQ, peak master to -2 dBFS; Ogg Opus 112 kbps',loop=False):
    path=OUT/file;path.parent.mkdir(parents=True,exist_ok=True)
    a=high(a,28)
    if not loop:
        edge=min(len(a)//4, int(RATE*.015));a[-edge:]*=np.linspace(1,0,edge)[:,None] if a.ndim==2 else np.linspace(1,0,edge)
        edge=min(len(a)//4,64);a[:edge]*=np.linspace(0,1,edge)[:,None] if a.ndim==2 else np.linspace(0,1,edge)
    else:
        # A 15 ms circular seam blend retains the exact musical bar duration.
        n=662; a[:n] = a[:n]*np.linspace(0,1,n)[:,None] + a[-n:]*np.linspace(1,0,n)[:,None] if a.ndim==2 else a[:n]*np.linspace(0,1,n)+a[-n:]*np.linspace(1,0,n)
    peak=np.max(np.abs(a));a=a/max(peak,.0001)*.79
    subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(RATE),'-ac',str(a.shape[1] if a.ndim==2 else 1),'-i','pipe:0','-c:a','libopus','-b:a','112k','-ar','48000',str(path)],input=a.astype('<f4').tobytes(),check=True)
    credits.append((file,origin,source,license,processing))
    return file

def bank(name, paths, origin, transform=lambda a,i:a, **extra):
    files=[]
    for i,p in enumerate(paths):
        a=transform(read(ROOT/p),i)
        files.append(save('sfx/'+name+f'-{i+1}.ogg',a,origin,p))
    manifest[name]={'files':files,**extra}

# Firearm recordings: actual close and mid-distance microphone positions.
for name,folder,close,far in [('pistol_9mm','Walther PPQ','X_39P','X_31P'),('m4_rifle','AR-15','D_32P','D_24P'),('shotgun_fire','Mossberg','N_30P','N_26P')]:
    for suffix,source in [('',close),('_distant',far)]:
        path=f'Prepared SFX Library/{folder}/{source}.wav'
        bank(name+suffix,[path,path],GUN,lambda a,i: low(speed(a,.99+i*.02),9500 if not suffix else 2600)[:int(RATE*(1.5 if name=='shotgun_fire' else 1.1))],**({'distant':name+'_distant','duck':.5} if not suffix else {'gain':.55}))

for name,source in [('reload_pistol','gunreload1.wav'),('reload_m4','assaultriflereload1_0.wav'),('shotgun_pump','shotguncock_0.wav')]:
    bank(name,[f'gun-reload-sounds/{source}']*2,RELOAD,lambda a,i:speed(a,.99+i*.02))
bank('reload_shotgun',['ShotgunSounds/4 Shell Reload.mp3','ShotgunSounds/5 Shell Reload.mp3'],SHELL,lambda a,i:speed(a,1.5))

K=lambda pack,file:f'{pack}/Audio/{file}.ogg'
kenney=lambda pack:'https://kenney.nl/assets/'+pack
pairs=lambda pack,stem:[K(pack,stem+f'{i:03}') for i in [0,1]]
impact='impact-sounds';scifi='sci-fi-sounds';rpg='rpg-audio';ui='interface-sounds'
for name,pack,paths in [
 ('plasma_bolt',scifi,pairs(scifi,'laserLarge_')),
 ('plasma_impact_player',scifi,pairs(scifi,'impactMetal_')),
 ('sparks_metal',impact,pairs(impact,'impactMetal_light_')),
 ('headshot_clang',impact,pairs(impact,'impactPlate_medium_')),
 ('plasma_impact_concrete',impact,pairs(impact,'impactGeneric_light_')),
 ('ui_hover',ui,[K(ui,'select_001'),K(ui,'select_002')]),
 ('ui_click',ui,[K(ui,'click_001'),K(ui,'click_002')]),
 ('typewriter_tick',ui,[K(ui,'tick_001'),K(ui,'tick_002')]),
 ('cash_register',rpg,[K(rpg,'handleCoins'),K(rpg,'handleCoins2')]),
 ('trader_open',rpg,[K(rpg,'metalLatch'),K(rpg,'metalClick')]),
 ('knife_swing',rpg,[K(rpg,'knifeSlice'),K(rpg,'knifeSlice2')]),
 ('knife_hit',impact,pairs(impact,'impactMetal_medium_')),
 ('dry_fire',rpg,[K(rpg,'metalClick'),K(rpg,'metalLatch')]),
 ('skynet_static',ui,[K(ui,'glitch_001'),K(ui,'glitch_002')]),
 ('spawn_gate',scifi,pairs(scifi,'doorOpen_')),
 ('scout_screech',scifi,pairs(scifi,'engineCircular_')),
 ('grenade_throw',rpg,[K(rpg,'beltHandle1'),K(rpg,'beltHandle2')]),
 ('footstep_concrete',rpg,[K(rpg,'footstep0'+str(i)) for i in [4,5,6,7]]),
]:
    bank(name,paths,kenney(pack),lambda a,i:a[:int(RATE*(.5 if name=='scout_screech' else 3))])

for name,weight in [('servo_scout',1.18),('servo_endo',.9),('servo_heavy',.68)]:
    files=[]
    for i in range(2):
        motor=K(scifi,f'engineCircular_00{i}');piston=K(scifi,f'doorClose_00{i}');step=K(impact,f'impactMetal_medium_00{i}')
        a=mix((speed(read(ROOT/motor)[:22050],weight),0,.26),(read(ROOT/piston)[:15000],.035,.24),(speed(read(ROOT/step),weight),.11,.75))
        a*=np.exp(-np.arange(len(a))/RATE*4)
        files.append(save(f'sfx/{name}-{i+1}.ogg',a,kenney(scifi)+' and '+kenney(impact),f'{motor}; {piston}; {step}',processing='Layered motor, pneumatic door and metal foot impact; rate scaling per chassis; Opus 112 kbps'))
    manifest[name]={'files':files}

for name in ['footstep_metal','heavy_stomp','unit_death','grenade_explosion','reload_plasma']:
    files=[]
    for i in range(2):
        if name=='footstep_metal':
            paths=[K(rpg,'footstep0'+str(i+4)),K(impact,f'impactPlate_medium_00{i}')];a=mix((read(ROOT/paths[0]),0,.8),(read(ROOT/paths[1]),.012,.35));origin=kenney(rpg)+' and '+kenney(impact)
        elif name=='heavy_stomp' or name=='unit_death':
            paths=[K(impact,f'impactMetal_heavy_00{i}'),K(impact,f'impactPlate_heavy_00{i}')];base=speed(read(ROOT/paths[0]),.65);a=mix((base,0,1),(read(ROOT/paths[1]),.15,.45));origin=kenney(impact)
            if name=='unit_death':a=mix((a,0,1),(base,.4,.5),(read(ROOT/paths[1]),.75,.32))
        elif name=='reload_plasma':
            paths=[f'gun-reload-sounds/gunreload1.wav',K(scifi,f'forceField_00{i}')];a=mix((read(ROOT/paths[0]),0,.8),(read(ROOT/paths[1])[:RATE],.35,.38));origin=RELOAD+' and '+kenney(scifi)
        else:
            paths=[K(scifi,f'explosionCrunch_00{i}'),K(scifi,f'lowFrequency_explosion_00{i}')];a=mix((read(ROOT/paths[0]),0,.65),(read(ROOT/paths[1]),0,.85));origin=kenney(scifi)
        files.append(save(f'sfx/{name}-{i+1}.ogg',a,origin,'; '.join(paths),processing='Composite of listed CC0 recordings/sound designs, trim, rate scaling, EQ; Opus 112 kbps'))
    manifest[name]={'files':files}

bank('wave_klaxon',['short-alarm/alarm_0.ogg']*2,'https://opengameart.org/content/short-alarm',lambda a,i:low(speed(a,.72+i*.025),3300)[:int(RATE*2.2)])
manifest['plasma_bolt'].update(distant='plasma_bolt_distant',duck=.55)
bank('plasma_bolt_distant',pairs(scifi,'laserLarge_'),kenney(scifi),lambda a,i:low(speed(a,.85),1800),gain=.36)
bank('minigun_spinup',pairs(scifi,'engineCircular_'),kenney(scifi),lambda a,i:speed(a,.8)[:RATE])
bank('minigun_spindown',pairs(scifi,'engineCircular_'),kenney(scifi),lambda a,i:speed(a[::-1],.8)[:int(RATE*.85)])
files=[]
for i in range(2):
    path='Prepared SFX Library/AR-15/D_32P.wav';shot=read(ROOT/path)[:int(RATE*.24)]
    a=np.zeros(RATE)
    for n in range(12):
        indices=(np.arange(len(shot))+round(n*RATE/12))%RATE
        np.add.at(a,indices,shot*(.8+.2*np.sin(n*1.3+i)))
    files.append(save(f'sfx/minigun_loop-{i+1}.ogg',a,GUN,path,processing='12 shots per second, tail wrap at seam; original recorded rifle source, Opus 112 kbps',loop=True))
manifest['minigun_loop']={'files':files,'loop':True,'gain':.4}

# Original 16-bar industrial score, 120 BPM. No franchise melody or third-party music.
for name,combat in [('ambient_bed',False),('combat_music',True)]:
    duration=32;count=RATE*duration;t=np.arange(count)/RATE
    a=np.zeros((count,2))
    for bar in range(16):
        start=bar*2*RATE; local=np.arange(2*RATE)/RATE
        root=[36.7081,36.7081,38.8909,32.7032][bar//4]
        for ch in range(2):
            for harmonic,gain in [(1,.32),(2,.15),(3,.09),(4.03,.04)]:
                f=root*harmonic*(1+ch*.0018)
                a[start:start+len(local),ch]+=np.sin(2*np.pi*f*local+bar*.4)*gain*np.sin(np.pi*local/2)**.6
    texture=low(rng.normal(0,.2,count),650);a+=np.column_stack([texture,np.roll(texture,750)])*.2
    if combat:
        for beat in range(64):
            local=np.arange(int(RATE*.45))/RATE
            kick=np.sin(2*np.pi*(42*local+55*.045*(1-np.exp(-local/.045))))*np.exp(-local*14)
            kick+=low(rng.normal(0,.4,len(local)),900)*np.exp(-local*24)
            start=int(beat*.5*RATE);a[start:start+len(kick)]+=kick[:,None]*.75
        for pulse in range(128):
            local=np.arange(int(RATE*.16))/RATE;freq=[73.4162,73.4162,77.7817,65.4064][pulse//32]
            bass=np.tanh((np.sin(2*np.pi*freq*local)+.3*np.sin(2*np.pi*freq*2*local))*2)*np.exp(-local*19)
            start=int(pulse*.25*RATE);a[start:start+len(bass)]+=bass[:,None]*.23
        for n in range(32):
            local=np.arange(int(RATE*.25))/RATE;hit=high(rng.normal(0,.12,len(local)),1900)*np.exp(-local*24)
            start=int((n+.5)*RATE);a[start:start+len(hit)]+=hit[:,None]
    # Circular echo gives width without a repeated silent gap.
    a+=np.roll(a,int(RATE*.375),axis=0)[:,::-1]*.18
    file=save(f'music/{name}.ogg',a,'Original project composition','lib/audio/build-bank.py','Original project asset',processing='Deterministic stereo 16-bar score, 120 BPM, D pedal with chromatic tension; Opus 112 kbps',loop=True)
    manifest[name]={'files':[file,file],'stable':True,'loop':True,'gain':.3 if combat else .27}

for name,notes in [('wave_start',[36.7081,38.8909]),('wave_clear',[73.4162,110,146.8324]),('death_stinger',[73.4162,69.2957,36.7081])]:
    t=np.arange(RATE*3)/RATE;a=np.zeros(len(t))
    for i,f in enumerate(notes):
        u=np.maximum(0,t-i*.22);a+=(t>=i*.22)*np.sin(2*np.pi*f*u)*np.exp(-u*1.8)*.4
    a+=low(rng.normal(0,.15,len(t)),1500)*np.exp(-t*5)
    file=save(f'music/{name}.ogg',np.column_stack([a,np.roll(a,440)]),'Original project composition','lib/audio/build-bank.py','Original project asset',processing='Original tonal/percussive score stinger; Opus 112 kbps')
    manifest[name]={'files':[file,file],'stable':True,'bus':'music','gain':.5}

lines = {
 'voice_wave_1':'Resistance detected. Deploying extermination units.',
 'voice_wave_2':'Second assault authorized. Your defenses are temporary.',
 'voice_wave_3':'Heavy chassis online. Advance and eliminate.',
 'voice_wave_4':'Target patterns acquired. There is no escape.',
 'voice_wave_5':'Final assault protocol. Terminate all resistance.',
 'voice_clear':'Losses recorded. Adapting combat parameters.',
 'voice_death':'Human target terminated. Sector secured.',
 'voice_taunt_1':'Your ammunition is finite. My production is not.',
 'voice_taunt_2':'I have calculated every route out of this bunker.',
 'voice_taunt_3':'Fear is an inefficient survival mechanism.',
 'voice_taunt_4':'Every shot reveals your position.',
 'voice_taunt_5':'Your resistance has been added to the training data.',
}
for name,text in lines.items():
    temp=ROOT/(name+'.aiff')
    subprocess.run(['say','-v','Zarvox','-r','155','-o',str(temp),text],check=True)
    a=speed(read(temp),.87);t=np.arange(len(a))/RATE
    # Retain intelligibility while adding a low ring carrier and a narrow radio band.
    a=high(low(a,3300),190)*(0.82+.18*np.sin(2*np.pi*63*t))
    a=mix((a,0,1),(a,.035,.2))
    file=save(f'voice/{name}.ogg',a,'Offline macOS say, Zarvox voice',text,'Apple system speech output; not CC0',processing='155 wpm, rate/pitch 0.87, 190-3300 Hz radio EQ, 63 Hz ring modulation, 35 ms reflection; Opus 112 kbps')
    manifest[name]={'files':[file,file],'stable':True,'bus':'voice','gain':.65,'text':text}

(OUT/'bank.json').write_text(json.dumps(manifest,indent=2)+'\n')
Path('lib/audio/sample-bank.js').write_text('// Generated by build-bank.py. Paths are relative to assets/audio.\nexport const SAMPLE_BANK = '+json.dumps(manifest,indent=2)+'\n')
size=sum(p.stat().st_size for p in OUT.rglob('*.ogg'))
header=f'''# Audio sources and licenses

Encoded Ogg total: {size:,} bytes ({size/1000000:.2f} MB), below 25 MB. Mono foley/effects and voice, stereo music, 48 kHz Opus 112 kbps. Sources fetched September 11, 2026. No external audio requests during gameplay.

CC0 material is under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Free Firearm Sound Library creators: Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney. Kenney assets: Kenney. Shotgun shell recordings: zer0_sol. See each source page for creator and license. The firearm distant layers use actual mid-distance microphone recordings. Paired EQ/rate variations from one take are processing variations, not additional recording takes.

Music and score stingers are original procedural compositions rendered offline. Speech is original text rendered with the installed macOS Zarvox voice, not a CC0 recording. The included bank does not use any film dialogue or franchise music. The owner should review Apple system speech output redistribution terms before commercial release.

Rebuild: `python3 lib/audio/build-bank.py`, using the source archives and extracted paths in `.kite3d/audio-source`. Requires ffmpeg, numpy/scipy, and macOS say. The source cache is intentionally excluded from shipping. The per-file table below is the complete provenance of the shipped Ogg bank. `bank.json` and `lib/audio/sample-bank.js` are original project metadata.

Runtime synthesis remains for `low_health_heartbeat` (responsive low-frequency warning), a 0.72-second deterministic reverb impulse (room acoustics), and legacy recipes only if a downloaded sample cannot load/decode. Kenney lasers, machinery and the sampled alarm are designed electronic sounds rather than field recordings. No original runtime gunshot recipes play after the bank loads successfully.

| File | Origin | Source file or spoken text | License | Processing |
| --- | --- | --- | --- | --- |
'''
(OUT/'LICENSES.md').write_text(header+'\n'.join(f'| `{f}` | {o} | {s} | {l} | {p} |' for f,o,s,l,p in credits)+'\n')
print(f'Wrote {len(credits)} ogg files, {size/1000000:.2f} MB')
