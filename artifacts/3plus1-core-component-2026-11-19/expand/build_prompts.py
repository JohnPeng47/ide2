import json,re
from pathlib import Path
d=Path(__file__).resolve().parent
v2=json.load(open(d.parents[2]/'.diagrams-local/canvas-domain-model/eval-prompts/a46e491f-784a-4c4e-9b6e-a85356723da3.json'))['versions'][1]['stages']['alternative']
def cut(a,b):
  i=v2.index(a); j=v2.index(b,i); return i,j
V={}
V['modular']=dict(name='Modular structure',
check='confirm the module boundaries, visibility and dependencies you rely on',
framing='''A tree diagram can relate components in two ways:

- Vertical (modular): depth means "belongs to". A child is a submodule, type or function grouped within its parent's responsibility. Reading down a branch, you move from a module into the pieces it groups, and from what it exposes into what it keeps internal.
- Horizontal (relational): modules that depend on one another without one belonging to the other, e.g. a module using another's exposed interface, or a shared utility used by several modules.

A diagram is *flat* when its modules sit side by side as top-level peers, even when one actually belongs inside another, and the dependencies between them appear only as inline references. This hides how the system is organized.

Before:

  Podcast player
  |
  |-- library: shows, episodes, subscriptions
  |-- library/search: query parsing and index lookup
  |-- playback: public play / pause / seek API
  |-- playback/queue: ordered episode list
  |-- audio: decoder and output device wrappers
  |-- downloads: fetch and cache episode files
  `-- sync: progress upload; uses playback and library

After:

  Podcast player
  |
  |-- Library
  |   |-- Exposes: shows, episodes, subscribe()
  |   `-- Internal: Search
  |       |-- query parsing
  |       `-- index lookup
  |-- Playback
  |   |-- Exposes: play / pause / seek / enqueue
  |   |-- Internal: Queue (ordered episode references)
  |   `-- -> depends on Audio.load / start and Downloads.cachedFile
  |-- Audio (shared; exposes load / start / stop)
  |-- Downloads
  |   `-- Exposes cachedFile(); keeps its fetch scheduler internal
  `-- Sync
      |-- -> depends on Playback position events
      `-- -> depends on Library episode identities
''',
hide='nodes that hide modular structure of their own, i.e. modules that group submodules',
nest='a primarily *vertical*, modular structure: nest each component under the module it belongs to, so the shape of the tree alone shows how the system is organized and what each module exposes or keeps internal',
exceptions='(e.g. a shared utility used by many modules, or an interface consumed across a boundary). Do not force these under a false parent; instead, express the relation as an annotated dependency line under the specific module or interface that depends on it')
V['call']=dict(name='Call',
check='confirm the call paths, ordering and hand-offs you rely on',
framing='''A tree diagram can relate components in two ways:

- Vertical (call): depth means "is invoked during". A child is a call made by, or a step performed within, its parent activation. Reading down a branch, you move from an operation into the steps that carry it out, in execution order.
- Horizontal (relational): activations that affect one another without one invoking the other, e.g. a message queued for another thread's loop, an event delivered to a listener, or a shared operation entered from several flows.

A diagram is *flat* when its operations sit side by side as top-level peers, even when one runs only inside another, and the calls between them appear only as inline references. This hides how behavior unfolds.

Before:

  Podcast player
  |
  |-- play(episode): user starts an episode
  |-- loadEpisode(): resolves the cached file
  |-- AudioEngine.start(): begins output
  |-- downloadEpisode(): fetches a missing file
  |-- enqueue(episode): adds to queue; calls onQueueChanged
  |-- onQueueChanged(): notifies listeners
  `-- syncTick(): every 30s uploads progress

After:

  Podcast player
  |
  |-- play(episode)
  |   |-- PlaybackController.loadEpisode(episode)
  |   |   |-- Downloads.cachedFile(episode)
  |   |   |   |-- Hit -> file path
  |   |   |   `-- Miss -> downloadEpisode(episode), then retry
  |   |   `-- AudioEngine.load(file)
  |   `-- AudioEngine.start()
  |       `-- audio thread pulls decoded frames until paused
  |-- enqueue(episode)
  |   |-- PlaybackQueue.append(episode)
  |   `-- onQueueChanged()
  |       `-- -> notifies SyncService (see syncTick)
  `-- syncTick() (timer, every 30s)
      |-- read PlaybackState.position
      `-- SyncClient.upload(progress)
''',
hide='nodes that hide call structure of their own, i.e. operations whose steps make calls of their own',
nest='a primarily *vertical*, call structure: nest each step under the activation it runs within, in execution order, so the shape of the tree alone shows how behavior unfolds',
exceptions='(e.g. a message handed to another thread\'s loop, an event delivered to a listener, or a shared operation entered from several flows). Do not force these under a false parent; instead, express the relation as an annotated line under the specific step that hands off or re-enters')
V['ownership']=dict(name='Ownership',
check='confirm the owners, lifetimes and references you rely on',
framing='''A tree diagram can relate components in two ways:

- Vertical (ownership): depth means "is owned by". A child is created, retained or released by its parent, and does not outlive it unless handed off. Reading down a branch, you move from a long-lived owner into the state and resources it holds.
- Horizontal (relational): components that use one another's state without owning it, e.g. a borrowed reference to a shared service, a handle passed to a worker, or a cache read by many holders.

A diagram is *flat* when its owned things sit side by side as top-level peers, even when one is actually held by another, and the references between them appear only as inline mentions. This hides who keeps what alive.

Before:

  Podcast player
  |
  |-- LibraryWorkspace: app-lifetime object
  |-- PlayerSession: one per device
  |-- PlaybackQueue: list of episode references
  |-- PlaybackState: position / status
  |-- AudioEngine: one audio device
  |-- EpisodeCache: downloaded files on disk
  `-- SyncService: background uploader

After:

  Podcast player
  |
  |-- LibraryWorkspace (app lifetime)
  |   |-- AudioEngine: created at startup; released at shutdown
  |   |-- EpisodeCache: retained across sessions; evicts by size
  |   `-- sessions[deviceId]: PlayerSession
  |       |-- created on device connect; released on disconnect
  |       `-- PlaybackController
  |           |-- PlaybackQueue: replaced on a new playlist
  |           |-- PlaybackState: reset on stop
  |           `-- -> borrows AudioEngine and EpisodeCache
  `-- SyncService (app lifetime)
      |-- upload queue: drained every 30s
      `-- -> reads PlaybackState through session notifications
''',
hide='nodes that hide ownership structure of their own, i.e. owned things that hold state or resources of their own',
nest='a primarily *vertical*, ownership structure: nest each piece of state or resource under the owner that creates, retains and releases it, so the shape of the tree alone shows who keeps what alive',
exceptions='(e.g. a shared service borrowed by many holders, or a handle passed to a worker that does not own it). Do not force these under a false parent; instead, express the relation as an annotated reference line under the specific holder that borrows it')
V['data']=dict(name='Data dependency',
check='confirm the inputs, computations and derived values you rely on',
framing='''A tree diagram can relate components in two ways:

- Vertical (data dependency): depth means "is computed from". A child is an input its parent needs, and its own children are what that input needs in turn. Reading down a branch, you move from a result into what it is derived from.
- Horizontal (relational): values that inform one another without one being derived from the other at that point, e.g. a shared input used by several results, a value already expanded elsewhere and referenced by name, or an external input entering at several places.

A diagram is *flat* when its values sit side by side as top-level peers, even when one is actually computed from another, and the dependencies between them appear only as inline references. This hides what actually needs what.

Before:

  Podcast player
  |
  |-- Audio output: decoded samples to the device
  |-- Decoded samples: from the cached file
  |-- Cached file: downloaded episode bytes
  |-- Playback position: from seek target and elapsed samples
  |-- Listening progress: uploaded every 30s
  `-- Current episode: chosen from the queue

After:

  Podcast player
  |
  |-- Audio output
  |   `-- Compute: AudioEngine mixes decoded samples at the device rate
  |       |-- Decoded samples
  |       |   `-- Compute: decode(cached file, seek offset)
  |       |       |-- Cached file
  |       |       |   `-- Episode bytes from the feed URL [external]
  |       |       `-- Seek offset <- Playback position (reference)
  |       `-- Output device rate [external]
  |-- Playback position
  |   `-- Compute: seek target + elapsed samples / sample rate
  |       |-- User seek [external]
  |       `-- Elapsed samples, counted by AudioEngine
  `-- Listening progress
      `-- Compute: latest Playback position (reference) per Current episode
          `-- Current episode <- head of the user-ordered queue [external]
''',
hide='nodes that hide derivation of their own, i.e. inputs that are themselves computed from other inputs',
nest='a primarily *vertical*, data-dependency structure: nest each input under the value computed from it, so the shape of the tree alone shows what actually needs what',
exceptions='(e.g. a shared input used by many results, or a value already expanded elsewhere). Do not force these under a false parent or expand them twice; instead, express the relation as an annotated reference line at the specific computation that uses it')
old_check='confirm the containment, ownership and relationships you rely on'
old_hide='nodes that hide composition of their own, i.e. parts that have parts, and pull that composition out downward'
old_nest='a primarily *vertical*, compositional structure: nest each component under the component it belongs to, so the shape of the tree alone shows what the system is made of and how the parts fit together'
old_exc='(e.g. a shared service used by many parts, or an external producer that acts on a part from outside). Do not force these under a false parent; instead, express the relation as an annotated line at the point in the vertical structure where the interaction happens, e.g. a call or notification line under the specific operation that triggers it'
fa,fb=cut('A tree diagram can relate components in two ways:','1. Choose which diagrams to expand')
for s in [old_check,old_hide,old_nest,old_exc]: assert v2.count(s)==1,s
out={}
for k,v in V.items():
  t=v2[:fa]+v['framing']+'\n'+v2[fb:]
  t=t.replace(old_check,v['check']).replace(old_hide,v['hide']+', and pull that structure out downward').replace(old_nest,v['nest']).replace(old_exc,v['exceptions'])
  (d/f'{k}.txt').write_text(t); out[k]=v['name']; print(k,len(t))
json.dump(out,open(d/'names.json','w'))
