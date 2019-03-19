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
		if (lines[i].length == 0 && branch != null) {
			this.branches.push(branch);
			branch = null;
			continue;
		}
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
		this.branches.push(branch);
	}
}

