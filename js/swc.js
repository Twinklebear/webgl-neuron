// Load the SWC Tree structure from the swc file passed
var SWCTree = function(swcFile) {
	var lines = swcFile.split("\n");
	this.branches = [];
	this.indices = []
	this.points = []
	var branch = {}
	for (var i = 0; i < lines.length; ++i) {
		if (lines[i][0] == "#") {
			continue;
		}
		var vals = lines[i].split(" ");
		var id = parseInt(vals[0]);
		var x = parseFloat(vals[2]);
		var y = parseFloat(vals[3]);
		var z = parseFloat(vals[4]);
		var parentID = parseInt(vals[6]);
		if (id == 1) {
			branch = { "start": 0 };
			this.indices.push(0);
		} else if (parentID != id - 1) {
			branch["count"] = this.indices.length - branch["start"];
			this.branches.push(branch);

			branch = { "start": this.indices.length };
			// IDs in the file start at 1
			this.indices.push(parentID - 1);
			this.indices.push(this.points.length / 3);
		} else {
			this.indices.push(this.points.length / 3);
		}
		this.points.push(x);
		this.points.push(y);
		this.points.push(z);
	}
	this.branches.push(branch);
}

