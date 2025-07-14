var fs = require('fs')
const { readdir } = require('fs/promises');
const path = require('path');

//database name

const dbname =process.argv[3] ;
//console.log(dbname);
const dbname2 = dbname.charAt(0).toUpperCase() + dbname.slice(1);



//database file content
var dbcontent=`const { Schema, model } = require("mongoose");

const ${dbname+'Schema'} = new Schema({});
const ${dbname2}= model("${dbname2}", ${dbname+'Schema'});
module.exports = ${dbname2};`;
 
//seeder file content    
var filecontent = `
const mongoose = require("mongoose");
require("dotenv").config();

const ${dbname2} = require("../Models/${dbname}.model");
const { connection } = require("../connection");

// seeder data here 
const data = [];

const init = async (data) => {
    try {
        console.log("running seeder !");
        connection();
        ${dbname2}.deleteMany({},(error) => {
            if (error) { 
                console.log(error);
            }  
        });
        console.log("adding seeder record/s !");
        ${dbname2}.insertMany(data, (error, docs) => {
            if (error) console.log(error);
            else console.log ("DB seed complete");
            process.exit();
        });

        console.log("running seeder !");   
    } catch (error) {
        console.log("Error seeding DB :: ", error?.message);
        process.exit();
    } 
};

init(data);`;


const makeseeder = async (file,dir) => {
    //reading directories
    // console.log("nv",dbname);
    const seederpath=path.join(dir+'/Database/Seeder')
    const files = await readdir(seederpath); 
    const dbpath=path.join(dir+'/Database/Models')
    const dbfiles = await readdir(dbpath);
    console.log(process.argv);

    //checking main files
    if(file==="createseeder"||file==="index")
    {
      console.log("Cannot run seeder with these file names")
      return;
    }
    
    //checking if file already exists
    if(files.includes (`${file}.js`)||dbfiles.includes(`${dbname2}.js`))
    {
        console.log("File already exists");
    }
    else
    {
        //create a db file
        //write async content into the  db file created
        if(process.argv[5]==='m')
        fs.writeFileSync(path.join(dbpath,`${dbname}.model.js`), dbcontent,"UTF8")

        //create a seeder file
        //write async content into the  seeder file created
        
        fs.writeFileSync(path.join(seederpath,`${file}.js`), filecontent,"UTF8")
}

}
module.exports={makeseeder};
