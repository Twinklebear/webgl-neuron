// Load the SWC Tree structure from the swc file passed
var SWCTree = function(swcFile, name) {
    this.name = name;
    this.branches = [];
    this.indices = []
    this.points = []
    this.numSoma = 0;

    this.vao = null;
    this.vbo = null;
    this.ebo = null;

    var branch = null;
    var lines = swcFile.split("\n");
    for (var i = 0; i < lines.length; ++i) {
        if (lines[i][0] == "#") {
            continue;
        }
        if (lines[i].length == 0 && branch != null) {
            branch["count"] = this.indices.length - branch["start"];
            this.branches.push(branch);
            branch = null;
            continue;
        }
        var vals = lines[i].trim().split(" ");
        var id = parseInt(vals[0]);
        var x = parseFloat(vals[2]);
        var y = parseFloat(vals[3]);
        var z = parseFloat(vals[4]);
        var parentID = parseInt(vals[6]);
        if (id == 1) {
            branch = { "start": 0 };
            this.indices.push(0);
            this.numSoma = 1;
        } else if (parentID != id - 1 || parentID == -1) {
            branch["count"] = this.indices.length - branch["start"];
            this.branches.push(branch);

            branch = { "start": this.indices.length };
            // IDs in the file start at 1
            if (parentID != -1) {
                this.indices.push(parentID - 1);
            } else {
                this.numSoma += 1;
            }
            this.indices.push(this.points.length / 3);
        } else {
            this.indices.push(this.points.length / 3);
        }
        this.points.push(x);
        this.points.push(y);
        this.points.push(z);
    }
    if (branch) {
        branch["count"] = this.indices.length - branch["start"];
        this.branches.push(branch);
    }
}

var distance = function(a, b) {
    return Math.sqrt(Math.pow(a[0] - b[0], 2.0) + Math.pow(a[1] - b[1], 2.0) + Math.pow(a[2] - b[2], 2.0));
}

// Compute the difference lines between the two trees to draw as line segments
// to visualize the difference between the two trees
var computeTreeDifferences = function(a, b) {
    var segments = [];

    // TODO: Is it worth building a k-d tree to accelerate the queries? Most of the SWCs
    // we're comparing should be pretty small
    for (var i = 0; i < a.points.length / 3; ++i) {
        var pa = [a.points[i * 3], a.points[i * 3 + 1], a.points[i * 3 + 2]];

        var dist = Number.POSITIVE_INFINITY;
        var nearest_pt = -1;
        for (var j = 0; j < b.points.length / 3; ++j) {
            var pb = [b.points[j * 3], b.points[j * 3 + 1], b.points[j * 3 + 2]];
            var d = distance(pa, pb);
            if (d < dist) {
                dist = d;
                nearest_pt = j;
            }
        }
        var pb = [b.points[nearest_pt * 3], b.points[nearest_pt * 3 + 1], b.points[nearest_pt * 3 + 2]];
        segments = segments.concat(pa).concat(pb);
    }

    for (var i = 0; i < b.points.length / 3; ++i) {
        var pb = [b.points[i * 3], b.points[i * 3 + 1], b.points[i * 3 + 2]];

        var dist = Number.POSITIVE_INFINITY;
        var nearest_pt = -1;
        for (var j = 0; j < a.points.length / 3; ++j) {
            var pa = [a.points[j * 3], a.points[j * 3 + 1], a.points[j * 3 + 2]];
            var d = distance(pa, pb);
            if (d < dist) {
                dist = d;
                nearest_pt = j;
            }
        }
        var pa = [a.points[nearest_pt * 3], a.points[nearest_pt * 3 + 1], a.points[nearest_pt * 3 + 2]];
        segments = segments.concat(pa).concat(pb);
    }
    return segments;
}

