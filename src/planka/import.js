import { setupPlankaClient, getMe, createImportProject, createBoard, createLabel, createCardLabel, createList, createCard, createTask, createComment, createAttachment } from './client.js';
import { loadTrelloBoard, getBoardName, getTrelloLists, getTrelloCardsOfList, getAllTrelloCheckItemsOfCard, getTrelloCommentsOfCard, getUsedTrelloLabels } from '../trello/export.js';
import { getImportedCommentText } from './comments.js';
import { getPlankaLabelColor } from './labels.js';
import { setupTrelloClient, downloadAttachment } from '../trello/client.js';
import { reportLabelMapping, reportProjectAndBoard, reportStartup, reportListMapping, reportCardMapping, reportDone, reportTaskMapping, reportActionMapping, reportAttachmentMapping } from '../utils/report.js';

export const importTrelloBoard = async (config, filename) => {
    reportStartup(config, filename);
    await loadTrelloBoard(filename);
    await setupPlankaClient(config);
    setupTrelloClient(config);

    const me = await getMe();
    const { plankaBoard } = await getPlankaProjectAndBoard(config);

    const trelloToPlankaLabels = await importLabels(plankaBoard);
    await importLists(plankaBoard, {config, me, trelloToPlankaLabels});
    reportDone();
}

async function getPlankaProjectAndBoard(config) {
    let project;
    if(config?.importOptions?.existingProjectId) {
        project = {
            id: config.importOptions.existingProjectId
        };
    } else {
        project = await createImportProject(config?.importOptions?.createdProjectName || 'Trello Import');
    }
    const plankaBoard = await createBoard({
        name: getBoardName(),
        projectId: project.id,
        type: 'kanban',
        position: 1
    });
    reportProjectAndBoard(project, plankaBoard);
    return { project, plankaBoard };
}

async function createProjectAndBoard(createdProjectName) {
    const project = await createImportProject(createdProjectName || 'Trello Import');
    const plankaBoard = await createBoard({
        name: getBoardName(),
        projectId: project.id,
        type: 'kanban',
        position: 1
    });
    reportProjectAndBoard(project, plankaBoard);
    return { project, plankaBoard };
}

async function importLabels(plankaBoard) {
    const trelloToPlankaLabels = {};
    for(const [idx, trelloLabel] of getUsedTrelloLabels().entries()) {
        const plankaLabel = await createLabel({
            boardId: plankaBoard.id,
            name: trelloLabel.name || null,
            color: getPlankaLabelColor(trelloLabel.color),
            position: idx
        });
        trelloToPlankaLabels[trelloLabel.id] = plankaLabel;
    }
    reportLabelMapping(trelloToPlankaLabels);
    return trelloToPlankaLabels;
}

async function importLists(plankaBoard, {config, me, trelloToPlankaLabels}) {
    for (const trelloList of getTrelloLists(!!config?.importOptions?.importArchivedItems)) {
        const plankaList = await createList({
            name: getItemName(trelloList),
            boardId: plankaBoard.id,
            position: trelloList.pos
        });
        reportListMapping(trelloList, plankaList);

        await importCards(trelloList, plankaBoard, plankaList, {config, me, trelloToPlankaLabels});
    }
}

async function importCards(trelloList, plankaBoard, plankaList, {config, me, trelloToPlankaLabels}) {
    for (const trelloCard of getTrelloCardsOfList(trelloList.id, !!config?.importOptions?.importArchivedItems)) {
        const plankaCard = await createCard({
            boardId: plankaBoard.id,
            listId: plankaList.id,
            position: trelloCard.pos,
            name: getItemName(trelloCard),
            description: trelloCard.desc || null,
            dueDate: trelloCard.due || undefined
        });
        reportCardMapping(trelloCard, plankaCard);

        await importCardLabels(trelloCard, plankaCard, trelloToPlankaLabels);
        await importTasks(trelloCard, plankaCard);
        await importComments(trelloCard, plankaCard, me);
        await importAttachments(trelloCard, plankaCard, config, me);
    }
}

async function importCardLabels(trelloCard, plankaCard, trelloToPlankaLabels) {
    for (const trelloLabel of trelloCard.labels) {
        await createCardLabel({
            cardId: plankaCard.id,
            labelId: trelloToPlankaLabels[trelloLabel.id].id
        });
    }
}

async function importTasks(trelloCard, plankaCard) {
    // TODO find workaround for tasks/checklist mismapping, see issue trello2planka#5
    for (const trelloCheckItem of getAllTrelloCheckItemsOfCard(trelloCard.id)) {
        const plankaTask = await createTask({
            cardId: plankaCard.id,
            position: trelloCheckItem.pos,
            name: trelloCheckItem.name,
            isCompleted: trelloCheckItem.state === 'complete'
        });
        reportTaskMapping(trelloCheckItem, plankaTask);
    }
}

async function importComments(trelloCard, plankaCard, me) {
    const trelloComments = getTrelloCommentsOfCard(trelloCard.id);
    trelloComments.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (const trelloComment of trelloComments) {
        const plankaAction = await createComment({
            cardId: plankaCard.id,
            type: 'commentCard',
            text: getImportedCommentText(trelloComment),
            userId: me.id
        });
        reportActionMapping(trelloComment, plankaAction);
    }
}

async function importAttachments(trelloCard, plankaCard, config, me) {
    if (!config?.importOptions?.fetchAttachments) {
        return;
    }
    for (const trelloAttachment of trelloCard.attachments) {
        await downloadAttachment(trelloCard.id, trelloAttachment.id, trelloAttachment.fileName);
        if (trelloAttachment.isUpload) {
            const plankaAttachment = await createAttachment(plankaCard.id, trelloAttachment.fileName);
            reportAttachmentMapping(trelloAttachment, plankaAttachment);
        }
        else {
            console.log('non-upload attachment - attaching it as an activity');
            const plankaAction = await createComment({
                cardId: plankaCard.id,
                type: 'commentCard',
                text: "[" + trelloAttachment.name + "](" + trelloAttachment.url + ")",
                userId: me.id

            });
            reportActionMapping(trelloAttachment, plankaAction);
        }
    }
}

const getItemName = (item) => (item.closed ? '[ARCHIVED] ' : '') + item.name;
