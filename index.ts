import * as core from '@actions/core'
import * as github from '@actions/github'
import * as AdmZip from 'adm-zip'
import * as filesize from 'filesize'

const pathname = require('path')
const fs = require('fs')

async function index() {
    try {
        const token = core.getInput("github_token", { required: true })
        const workflow = core.getInput("workflow", { required: true })
        const [owner, repo] = core.getInput("repo", { required: true }).split("/")
        const path = core.getInput("path", { required: true })
        const name = core.getInput("name")
        let workflowConclusion = core.getInput("workflow_conclusion")
        let pr = parseInt(core.getInput("pr"));
        let commit = core.getInput("commit")
        let branch = core.getInput("branch")
        let event = core.getInput("event")
        let runID = core.getInput("run_id") ? parseInt(core.getInput("run_id")) : undefined;
        let runNumber = core.getInput("run_number") ? parseInt(core.getInput("run_number")) : undefined;
        let checkArtifacts = core.getInput("check_artifacts")
        let searchArtifacts = core.getInput("search_artifacts")
        let checkOnly = core.getInput("check_only")
        let unpack = core.getInput("unpack") === "true"

        const client = github.getOctokit(token)

        console.log("==> Workflow:", workflow)

        console.log("==> Repo:", owner + "/" + repo)

        console.log("==> Conclusion:", workflowConclusion)

        if (pr) {
            console.log("==> PR:", pr)

            const pull = await client.rest.pulls.get({
                owner: owner,
                repo: repo,
                pull_number: pr,
            })
            commit = pull.data.head.sha
        }

        if (commit) {
            console.log("==> Commit:", commit)
        }

        if (branch) {
            branch = branch.replace(/^refs\/heads\//, "")
            console.log("==> Branch:", branch)
        }

        if (event) {
            console.log("==> Event:", event)
        }

        if (runNumber) {
            console.log("==> RunNumber:", runNumber)
        }

        if (!runID) {
            for await (const runs of client.paginate.iterator(client.rest.actions.listWorkflowRuns, {
                owner: owner,
                repo: repo,
                workflow_id: workflow,
                branch: branch,
                event: event,
            }
            )) {
                for (const run of runs.data) {
                    if (commit && run.head_sha != commit) {
                        continue
                    }
                    if (runNumber && run.run_number != runNumber) {
                        continue
                    }
                    if (workflowConclusion && (workflowConclusion != run.conclusion && workflowConclusion != run.status)) {
                        continue
                    }
                    if (checkArtifacts || searchArtifacts) {
                        let artifacts = await client.rest.actions.listWorkflowRunArtifacts({
                            owner: owner,
                            repo: repo,
                            run_id: run.id,
                        })
                        if (artifacts.data.artifacts.length == 0) {
                            continue
                        }
                        if (searchArtifacts) {
                            const artifact = artifacts.data.artifacts.find((artifact) => {
                                return artifact.name == name
                            })
                            if (!artifact) {
                                continue
                            }
                        }
                    }
                    runID = run.id
                    break
                }
                if (runID) {
                    break
                }
            }
        }

        if (runID) {
            console.log("==> RunID:", runID)
        } else {
            throw new Error("no matching workflow run found")
        }

        let artifactsRaw = (await client.paginate(client.rest.actions.listWorkflowRunArtifacts, {
            owner: owner,
            repo: repo,
            run_id: runID,
        }))

        console.log(artifactsRaw);
        const artifacts = artifactsRaw?.filter(artifact => !name || artifact.name === name)

        if (artifacts?.length == 0)
            throw new Error("no artifacts found")

        if(checkOnly)
        {
            core.setOutput("exists", true);
            return;
        }

        for (const artifact of artifacts) {
            console.log("==> Artifact:", artifact.id)

            const size = filesize(artifact.size_in_bytes, { base: 10 })

            console.log(`==> Downloading: ${artifact.name}.zip (${size})`)

            const zip = await client.rest.actions.downloadArtifact({
                owner: owner,
                repo: repo,
                artifact_id: artifact.id,
                archive_format: "zip",
            })


            if(unpack === true)
            {
                const dir = name ? path : pathname.join(path, artifact.name)

                fs.mkdirSync(dir, { recursive: true })

                const adm = new AdmZip(Buffer.from(zip.data as any))

                adm.getEntries().forEach((entry) => {
                    const action = entry.isDirectory ? "creating" : "inflating"
                    const filepath = pathname.join(dir, entry.entryName)

                    console.log(`  ${action}: ${filepath}`)
                })

                adm.extractAllTo(dir, true)
            }

        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

index()

