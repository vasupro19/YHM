const { init } = require('./runSeeder.script');
const { makeseeder } = require('./createSeeder.script');
const arguments = process.argv.slice(2);
const current_dir = process.cwd();

const decide_action = async (arguments, current_dir) => {
    const condition = arguments[0];
    const file_name = arguments[1];

    try {
        switch (condition) {
            case 'make':
                await makeseeder(file_name, current_dir);
                break;
            case 'seed':
                await init(file_name, current_dir);
                break;

            default:
                let help = ` 
        make seeder_name   ::[creates a seeder with specified name]
        i.e: npm run seeder make test

        make seeder_name - m   ::[creates a seeder and model with specified name]
        i.e: npm run seeder make test - m

        seed seeder_name   ::[executes specified seeder]
        i.e: npm run seeder seed test
        `;
                console.log('No arguments supplied, please specify one of the listed action:');
                console.log(help);
                break;
        }
    } catch (error) {
        console.log('error making script decision');
        console.log(error);
    }
};

decide_action(arguments, current_dir);
