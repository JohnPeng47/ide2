[MOTIVATION]
- we want to formalize some
- the IDE, hoping between links, was not designed but emerged as a result of the complexity of source code 

[S1:Definitions]
1.  first let's define the traditional navigation code workflow as G_IDE
    
    interface NavGraph
        N : List[Node]
        E : List[Edge]
        C : List[Concept]
        
    class G_IDE(N, E) implements NavGraph:
      > N = { "source files": f1, f2, ... fn }
      > E = { "relations": reference/definition/import .. etc }
      > C = { c1: "Auth API", c2: "Persistence Layer", .. }
        > [NOTE] this is just a label that refers to some feature in the codebase where its implementation is spread out across multiple source files

2.  okay now lets define a new graph, G_DIAG

    class G_DIAG(_N, *E, C) implements NavGraph:
      > R = { r1, r2, ... rm }, where r = f[a..b], f ∈ N   // slice of file f, lines a to b
      > node_repr : R -> _N
      > _N = { "node representation": node_repr(R) = { n1, n2, ... nk }}
      > _E = { "relations": some relations over _N ... }
      > C = { c1: "Auth API", c2: "Persistence Layer", .. }

    [NOTE] imo edges are almost derivative data models downstream of how nodes are defined, so we dont need to define them too precisely here

3.  let's define M as a mental representation (M) and (share-holder, jkjk) value (V)

    # read code
    M = coder.read(g: NavGraph)
    # writes code
    V = coder.write(M)

4.  let's define two navigation graphs, g_ide and g_diag

    # source files of some codebase
    FILES      = { f1, f2, ..., fn }
    E          = { "relations": reference/definition/import .. etc } over FILES
    R          = { r1, r2, ... rm }, where r = f[a..b], f ∈ FILES
    node_repr  : R -> _N
    *E         = { "relations": some relations over _N ...}
    
    # graphs
    g_diag = G_DIAG(
        _N: node_repr(R), 
        _E: *E, 
        C: C
    )
    g_ide = G_IDE(
        N: FILES, 
        E: E, 
        C: C
    )

    M_ide      = coder.read(g_ide)
    M_diag     = coder.read(g_diag)
    V_ide      = coder.write(M_ide)
    V_diag     = coder.write(M_diag)

[S2:DIAGRAPH]

5.  quick reality check:

    # assume
    V_ide == V_diag
    # implies
    N == _N
    # implies
    node_repr(R) = N
    # implies
    R = { r1 = f1[0..len(f1)-1], r2 = f2[0..len(f2)-1] .. }
    
    conclusion: so a trivially equivalent canvas representation would just use full source files as the nodes
    why?: just testing to make sure that the logical machinery works, that you can get outcomes that are tethered to reality

6.  lets define node_repr and its output
    proposal: let's use trees as an alternative representation to "hyper-text documents" display in the IDE

    C = { s1 = f1[a1..b1], s2 = f2[a2..b2] .. fn, where fi E FILES }
    # R is the set of  
    R = { 
        r1 : ([s1, s2 .. sn1], c1), 
        r2 : ([s1, s2 .. sn2], c2) 
        ..
        rn : ([sn .. snn], cn), 
        where ci E CONCEPTS 
    }

    node_repr : R -> NODE_TREES[]
    
    # what is a NODE TREE
    class Tree:
        a: Tree
        b: Tree