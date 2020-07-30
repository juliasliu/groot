// Show refresh button and overlay
var isLoading;

// Org Units data in JSON forms
var orgUnits;
var parentChildOUs;

// Search criteria
var searchName;

// Display criteria
var layerLimitNum;
var totalLayers;

/*
 * Initially loads the page, fetching all OUs and adding search events.
 */
async function onloadOUPage() {
    loginStatus();

    var searchButton = document.getElementById("search-enter-btn");
    searchButton.addEventListener("click", function(event) {
        searchName = searchBar.value;
        d3.select("svg").remove();
        getAllOUs();
    })

    var searchBar = document.getElementById("search");
    // Execute a function when the user presses enter or erases the input
    searchBar.addEventListener("search", function(event) {
        searchButton.click();
    });

    orgUnits = await fetchOUs();
    layerLimitNum = parseInt(document.getElementById("limit-layer-num").value);

    getAllOUs();
}

/*
 * Used to refresh the page upon deletion, creation, or update of OUs.
 */
async function refreshOUPage() {
    loginStatus();

    document.getElementById("search").value = '';
    searchName = '';

    // either remove the no-search-result-element or the visualization
    noSearchResultScreen = document.getElementById('no-search-result-elem');
    if (noSearchResultScreen) {
        noSearchResultScreen.remove();
    } else {
        d3.select("svg").remove();
    }

    orgUnits = await fetchOUs();
    layerLimitNum = parseInt(document.getElementById("limit-layer-num").value);

    getAllOUs();
}

/*
 * Fetches all OUs from the Admin SDK.
*/
async function fetchOUs() {
    // fetch all OUs from API
    try {
        const response = await fetch('https://www.googleapis.com/admin/directory/v1/customer/my_customer/orgunits?orgUnitPath=/&type=all', {
            headers: {
                'authorization': `Bearer ` + token,
            }
        });
        const directoryOUs = await response.json();
        orgUnits = directoryOUs['organizationUnits'];
        return orgUnits;
    } catch (error) {
        console.error('Error:', error);
    }
}

/*
 * Calls all the functions to manipulate OU data, and loads the sidebar and visualization.
*/
function getAllOUs() {
    isLoading = true;
    setLoadingOverlay();
    var limitedOUs = orgUnits;

    // Limit Layers always runs unless no search match, Search runs only if a query has been made
    if (searchName) {
        var searchedOU = searchOU(searchName);

        if (searchedOU) {
            // compile all parents of the searched org unit
            limitedOUs = [];
            var parentOrgUnitPath = searchedOU['parentOrgUnitPath'];
            parentArr = parentOrgUnitPath.split('/');
            // first elem is always empty
            parentArr.shift();

            // need to match OUs by paths (which are unique) rather than by names
            var pathSoFar = '';

            while (parentArr.length != 0) {
                pathSoFar = pathSoFar + '/' + parentArr.shift();

                for (unit of orgUnits) {
                    if (unit['orgUnitPath'] == pathSoFar) {
                        limitedOUs.push(unit);
                        break;
                    }
                }
            }

            // no sort needed, as OUs added in order of increasing depth
            limitedOUs.push(searchedOU);
        } else {
            limitedOUs = []
            loadSidebar(limitedOUs);
            noSearchResult();
            
            return;
        }
    }

    // limit layers code
    limitedOUs.sort(ouDepthSort); // sort by depth
    limitedOUs = limitLayers(limitedOUs);

    loadSidebar(limitedOUs);
    parentChildOUs = constructD3JSON(limitedOUs); // transform into parent-child JSON
    visualize(parentChildOUs); // visualize with D3
    addListeners();
}

/*
 * Constructs the no matching search results screen.
 */
function noSearchResult() {
    if (document.getElementById("no-search-result-elem")) {
        isLoading = false;
        setLoadingOverlay();
        return;
    }
    var div = document.createElement("div");
    div.classList.add("no-search-results");
    div.id = "no-search-result-elem";
    var p = document.createElement("P");
    p.innerHTML = "There were no results for your search."; 
    var refreshOUPageButton = document.createElement("BUTTON");
    refreshOUPageButton.innerHTML = "Reset all";
    refreshOUPageButton.classList.add("btn");
    refreshOUPageButton.classList.add("btn-primary");
    refreshOUPageButton.onclick = refreshOUPage;

    div.appendChild(p);
    div.appendChild(refreshOUPageButton);
    document.getElementById('chart-container').append(div);

    // loading is over
    isLoading = false;
    setLoadingOverlay();
}

/*
 * Returns a list of OUs within the layer depth limit.
*/
function limitLayers(limitedOUs) {
    if (limitedOUs.length == 0) {
        return [];
    }
    var lastElementDepth = computeDepth(limitedOUs[limitedOUs.length - 1]);
    // set the totalLayers global var
    totalLayers = lastElementDepth;
    if (totalLayers <= layerLimitNum) {
        return limitedOUs;
    } else {
        limitedOUList = [];

        for (current of limitedOUs) {
            if (computeDepth(current) > layerLimitNum) {
                break;
            }
            limitedOUList.push(current);
        }

        return limitedOUList;
    }
}

/* Fill in informational fields on the sidebar of the page */
function loadSidebar(limitedOUs) {
    const domainName = document.getElementById("domain-name");
    domainName.innerHTML = "@" + domain;

    const displayOUs = document.getElementById("display-ous");
    const displayLayers = document.getElementById("display-layers");
    const totalOUs = document.getElementById("total-ous");
    const totalLayerCount = document.getElementById("total-layers");

    var displayLimit = document.getElementById("limit-layer-num");
    displayLimit.setAttribute("max", totalLayers);
    
    if (limitedOUs.length == 0) {
        displayLayers.innerHTML = 0;
        displayOUs.innerHTML = 0;
    } else {
        displayLayers.innerHTML = computeDepth(limitedOUs[limitedOUs.length - 1]);
        displayOUs.innerHTML = limitedOUs.length + 1;
    }

    if (orgUnits.length == 0) {
        totalLayerCount.innerHTML = 1;
    } else {
        totalLayerCount.innerHTML = computeDepth(orgUnits[orgUnits.length - 1]);
    }
    totalOUs.innerHTML = orgUnits.length + 1;
}

/*
 * Constructs parent-child JSON by iterating over the OUs from API after sorting.
*/
function constructD3JSON(sortedOUs) {
    // initialize root OU
    var outputJson = {};
    outputJson['name'] = 'root';
    outputJson['children'] = [];

    for (var i = 0; i < sortedOUs.length; i++) {
        addToJSON(sortedOUs[i], outputJson);
    }
    return outputJson;
}

/*
 * Adds each OU to the output JSON in level-order (parents always in before children).
*/
function addToJSON(ou, outputJson) {
    var parentOrgUnitPath = ou['parentOrgUnitPath'];

    if (parentOrgUnitPath === '/') {
        // can add directly as child of root
        var json = {
            "name": ou['name'],
            "children": []
        };
        outputJson['children'].push(json);
        return;
    }

    var parentArr = parentOrgUnitPath.split('/');
     // first element of split will always be empty string
    parentArr.shift();

    currentLevel = outputJson['children'];
    // keep searching deeper until we've reached the OU's direct parent
    while (parentArr.length !== 0) {
        var parentQuery = parentArr.shift(); // pops off highest level parent
        for (var i = 0; i < currentLevel.length; i++) {
            if (currentLevel[i]['name'] === parentQuery) {
                currentLevel = currentLevel[i]['children'];
                break;
            }
        }
    }

    // once reached direct parent, append the OU to children
    var json = {
        "name": ou['name'],
        "children": []
    };
    currentLevel.push(json);
}

/*
 * Given a tree-like JSON, visualizes it with a tree diagram using D3.js.
*/
function visualize(orgUnitsTree) {
    // Set the dimensions and margins of the diagram
    var margin = {top: 40, right: 90, bottom: 50, left: 90},
        width = 1980 - margin.left - margin.right,
        height = 1500 - margin.top - margin.bottom;

    // append the svg object to the #tree-chart div
    // appends a 'group' element to 'svg'
    // moves the 'group' element to the top left margin
    var svg = d3.select("#tree-chart").append("svg")
        .attr("width", width + margin.right + margin.left)
        .attr("height", height + margin.top + margin.bottom)
    .append("g")
        .attr("transform", "translate("
            + margin.left + "," + margin.top + ")");

    var i = 0,
        duration = 750,
        root;

    // declares a tree layout and assigns the size
    var treemap = d3.tree().size([height, width]);

    // Assigns parent, children, height, depth
    root = d3.hierarchy(orgUnitsTree, function(d) { return d.children; });
    root.x0 = height / 2;
    root.y0 = 0;

    // Collapse after the second level
    root.children.forEach(collapse);

    update(root);

    // Collapse the node and all it's children
    function collapse(d) {
        if (d.children) {
            d._children = d.children
            d._children.forEach(collapse)
            d.children = null
        }
    }

    function update(source) {

        // Assigns the x and y position for the nodes
        var treeData = treemap(root);

        // Compute the new tree layout.
        var nodes = treeData.descendants(),
            links = treeData.descendants().slice(1);

        // Normalize for fixed-depth.
        nodes.forEach(function(d){ d.y = d.depth * 180});

        // ****************** Nodes section ***************************

        // Update the nodes...
        var node = svg.selectAll('g.node')
            .data(nodes, function(d) {return d.id || (d.id = ++i); });

        // Enter any new modes at the parent's previous position.
        var nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            .attr("transform", function(d) {
                return "translate(" + source.x0 + "," + source.y0 + ")";
            })
            .on('click', nodeClick);

        // Add Circle for the nodes
        nodeEnter.append('circle')
            .attr('class', 'node')
            .attr('r', 1e-6)
            .style("fill", function(d) {
                return d._children ? "lightsteelblue" : "#fff";
            });

        // Add labels for the nodes
        nodeEnter.append('text')
            .attr("dy", ".35em")
            .attr("y", function(d) {
                return d.children || d._children ? -18 : 18;
            })
            .attr("text-anchor", "middle")
            .text(function(d) { return d.data.name; });

        // UPDATE
        var nodeUpdate = nodeEnter.merge(node);

        // Transition to the proper position for the node
        nodeUpdate.transition()
            .duration(duration)
            .attr("transform", function(d) { 
                return "translate(" + d.x + "," + d.y + ")";
            });

        // Update the node attributes and style
        nodeUpdate.select('circle.node')
            .attr('r', 10)
            .style("fill", function(d) {
                return d._children ? "lightsteelblue" : "#fff";
            })
            .attr('cursor', 'pointer');


        // Remove any exiting nodes
        var nodeExit = node.exit().transition()
            .duration(duration)
            .attr("transform", function(d) {
                return "translate(" + source.x + "," + source.y + ")";
            })
            .remove();

        // On exit reduce the node circles size to 0
        nodeExit.select('circle')
            .attr('r', 1e-6);

        // On exit reduce the opacity of text labels
        nodeExit.select('text')
            .style('fill-opacity', 1e-6);

        // ****************** links section ***************************

        // Update the links...
        var link = svg.selectAll('path.link')
            .data(links, function(d) { return d.id; });

        // Enter any new links at the parent's previous position.
        var linkEnter = link.enter().insert('path', "g")
            .attr("class", "link")
            .attr('d', function(d){
                var o = {x: source.x0, y: source.y0}
                return diagonal(o, o)
            });

        // UPDATE
        var linkUpdate = linkEnter.merge(link);

        // Transition back to the parent element position
        linkUpdate.transition()
            .duration(duration)
            .attr('d', function(d){ return diagonal(d, d.parent) });

        // Remove any exiting links
        var linkExit = link.exit().transition()
            .duration(duration)
            .attr('d', function(d) {
                var o = {x: source.x, y: source.y}
                return diagonal(o, o)
            })
            .remove();

        // Store the old positions for transition.
        nodes.forEach(function(d){
            d.x0 = d.x;
            d.y0 = d.y;
        });

        // Creates a curved (diagonal) path from parent to the child nodes
        function diagonal(s, d) {

            path = `M ${s.x} ${s.y}
                    C ${s.x} ${(s.y + d.y) / 2},
                    ${d.x} ${(s.y + d.y) / 2},
                    ${d.x} ${d.y}`

            return path
        }

        // Toggle children on click.
        function nodeClick(d) {
            if (d.children) {
                d._children = d.children;
                d.children = null;
            } else {
                d.children = d._children;
                d._children = null;
            }
            update(d);
        }
    }

    // d3 visualization has loaded
    isLoading = false;
    setLoadingOverlay();
}

/*
 * Adds interactivity (zoom, drag) to the D3 visualization; adds onChange functions to form.
*/
function addListeners() {
    var scale = 1,
    panning = false,
    xoff = 0,
    yoff = 0,
    start = {x: 0, y: 0},
    treeChart = document.getElementById("tree-chart");
    editSelect = document.getElementById("edit-choice");

    function setTransform() {
        treeChart.style.transform = "translate(" + xoff + "px, " + yoff + "px) scale(" + scale + ")";
    }

    treeChart.onmousedown = function(e) {
        e.preventDefault();
        start = {x: e.clientX - xoff, y: e.clientY - yoff};    
        panning = true;
    }

    treeChart.onmouseup = function(e) {
        panning = false;
    }

    treeChart.onmousemove = function(e) {
        e.preventDefault();         
        if (!panning) {
            return;
        }
        xoff = (e.clientX - start.x);
        yoff = (e.clientY - start.y);
        setTransform();
        
    }

    treeChart.onwheel = function(e) {
        e.preventDefault();
        // take the scale into account with the offset
        var xs = (e.clientX - xoff) / scale,
            ys = (e.clientY - yoff) / scale,
            delta = (e.wheelDelta ? e.wheelDelta : -e.deltaY);

        // get scroll direction & set zoom level (with limits on zooming)
        if (delta > 0) {
            (scale < 1.6) ? (scale *= 1.2) : (scale *= 1);
        } else {
            (scale > 0.6) ? (scale /= 1.2) : (scale *= 1);
        }

        // reverse the offset amount with the new scale
        xoff = e.clientX - xs * scale;
        yoff = e.clientY - ys * scale;

        setTransform();          
    }

    editSelect.onchange = function(event) {
        createDiv = document.getElementById("edit-create");
        updateDiv = document.getElementById("edit-update");
        deleteDiv = document.getElementById("edit-delete");

        if (editSelect.value == "create") {
            deleteDiv.style.display = "none";
            updateDiv.style.display = "none";
            createDiv.style.display = "block";
        } else if (editSelect.value == "update") {
            deleteDiv.style.display = "none";
            createDiv.style.display = "none";
            updateDiv.style.display = "block";
        } else {
            updateDiv.style.display = "none";
            createDiv.style.display = "none";
            deleteDiv.style.display = "block";
        }
    }
}

/*
 * Rerenders visualization with new layer limit criteria.
*/
function renderLayers() {
    layerLimitNum = parseInt(document.getElementById("limit-layer-num").value);
    if (Number.isNaN(layerLimitNum) || layerLimitNum < 2) {
        layerLimitNum = 3;
    }
    // ensures we never display more than the available number of layers
    if (layerLimitNum > totalLayers) {
        layerLimitNum = totalLayers;
    }
    d3.select("svg").remove();
    getAllOUs();
}
