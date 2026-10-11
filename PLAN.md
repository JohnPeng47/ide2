[GOAL]
- Want to go with the original purpose which is to make plannotator thing

[CANVAS UPDATES]
- fix the long ID issue with all resource identifiers
    > could we maintain a presentation layer that converts long ids into short ones while still keeping long-ids?
    > do some math abt anti-collision concerns
    > compare to equivalent in tldraw
- grouping diagrams together
    - want to introduce both
- swap between diagram revisions in the canvas
    - add API for uploading diagram revisions
- fix history + snapshot
    - generate diagram for this
- integrate t3 code
    - can we just get it to be inter-operable with herdr?
[CLOUDFLARE]
"""
Project Vision
Problem to Solve: 
I guess the most acute instantiation of our problem is the current problem facing code-reviews in the post AI world: how do human swes keep up with waves after waves of 20K+ LOC PR diffs? I think the problem is more general, which is the, pressure that agentic coding write throughput has put against our current iteration of code reading workflows that is still largely being driven by UI/UX patterns of the pre-agentic era. 

So what are these patterns that are holding us back?

I think first is the tooling. The IDE, which is still designed 
"""


- what is our integration point?
    > run after every 1 commits?
        > [TEST] test best n, for n commits in batch of commits to generate diagrams over
    - what is our integration hooks using  
- what is our testing methodology gonna look like
    - think we should actually pick multiple repos
    - what are the most ideal code changes?
        - work backwards from this
        - steps:
            > 1. look through commits and find good commit ranges
                > criteria is a series of commits on the same set of diagram constructs
                > properties of an ideal representation
                    > a. all the core features are fixed, we are simply changing a small part
                    > b. depending 
            > 1. create a set of base diagrams
            > 2. create
    
[QoL]
- add colors to diagrams
    > where to implement?
- redesign API surface 
    - account for MCP, authenticated agents (generate token from app -> short-lived)
